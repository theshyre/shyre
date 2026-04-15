-- Rename organizations → teams (platform vocabulary cleanup)
--
-- "Organization" was the multi-tenant term from day one, but in product
-- vocabulary the workspace-of-users that collaborates on a Business is
-- better described as a "team". A Shyre account holder belongs to one
-- or more teams; each team runs one Business (customers, projects,
-- time, invoices, expenses). Renaming org → team aligns the data layer
-- with the UI language.
--
-- This migration renames:
--   - tables:     organizations, organization_members, organization_settings,
--                 organization_invites, organization_shares
--   - columns:    organization_id → team_id across every scoped table;
--                 organization_shares.parent_org_id / child_org_id →
--                 parent_team_id / child_team_id; error_logs.org_id → team_id
--   - indexes:    idx_*_org*_* → idx_*_team*_* for readability
--   - functions:  user_has_org_access → user_has_team_access,
--                 user_org_role → user_team_role,
--                 create_organization → create_team,
--                 user_can_see_cross_org_entries → user_can_see_cross_team_entries,
--                 propose_organization_share → propose_team_share,
--                 accept_organization_share → accept_team_share,
--                 change_customer_primary_org → change_customer_primary_team
--   - triggers:   handle_new_user + check_group_member_org bodies
--   - policies:   drop/recreate any policy whose name contains "org" with
--                 a team-named equivalent
--
-- All functions are renamed via ALTER FUNCTION (preserves OID) and then
-- bodies are rewritten via CREATE OR REPLACE — RLS policies that reference
-- these functions keep working because policy expressions bind by OID, not
-- by name.

-- ============================================================
-- 1. Tables
-- ============================================================

ALTER TABLE organizations         RENAME TO teams;
ALTER TABLE organization_members  RENAME TO team_members;
ALTER TABLE organization_settings RENAME TO team_settings;
ALTER TABLE organization_invites  RENAME TO team_invites;
ALTER TABLE organization_shares   RENAME TO team_shares;

-- ============================================================
-- 2. Columns — organization_id → team_id everywhere
-- ============================================================

ALTER TABLE team_members   RENAME COLUMN organization_id TO team_id;
ALTER TABLE team_settings  RENAME COLUMN organization_id TO team_id;
ALTER TABLE team_invites   RENAME COLUMN organization_id TO team_id;

ALTER TABLE team_shares    RENAME COLUMN parent_org_id TO parent_team_id;
ALTER TABLE team_shares    RENAME COLUMN child_org_id  TO child_team_id;

ALTER TABLE customers        RENAME COLUMN organization_id TO team_id;
ALTER TABLE customer_shares  RENAME COLUMN organization_id TO team_id;
ALTER TABLE projects         RENAME COLUMN organization_id TO team_id;
ALTER TABLE time_entries     RENAME COLUMN organization_id TO team_id;
ALTER TABLE invoices         RENAME COLUMN organization_id TO team_id;
ALTER TABLE expenses         RENAME COLUMN organization_id TO team_id;
ALTER TABLE security_groups  RENAME COLUMN organization_id TO team_id;
ALTER TABLE category_sets    RENAME COLUMN organization_id TO team_id;
ALTER TABLE time_templates   RENAME COLUMN organization_id TO team_id;

-- error_logs used org_id (not organization_id) since it was added as a
-- shorthand; unify it with the rest.
ALTER TABLE error_logs       RENAME COLUMN org_id TO team_id;

-- ============================================================
-- 3. Index renames (cleanliness — Postgres auto-updates column refs)
-- ============================================================

ALTER INDEX IF EXISTS idx_org_members_user_id    RENAME TO idx_team_members_user_id;
ALTER INDEX IF EXISTS idx_org_members_org_id     RENAME TO idx_team_members_team_id;
ALTER INDEX IF EXISTS idx_org_invites_token      RENAME TO idx_team_invites_token;
ALTER INDEX IF EXISTS idx_org_invites_email      RENAME TO idx_team_invites_email;

ALTER INDEX IF EXISTS idx_customers_org_id       RENAME TO idx_customers_team_id;
ALTER INDEX IF EXISTS idx_projects_org_id        RENAME TO idx_projects_team_id;
ALTER INDEX IF EXISTS idx_time_entries_org_id    RENAME TO idx_time_entries_team_id;
ALTER INDEX IF EXISTS idx_invoices_org_id        RENAME TO idx_invoices_team_id;

ALTER INDEX IF EXISTS idx_security_groups_org    RENAME TO idx_security_groups_team;
ALTER INDEX IF EXISTS idx_customer_shares_org    RENAME TO idx_customer_shares_team;

ALTER INDEX IF EXISTS idx_org_shares_parent      RENAME TO idx_team_shares_parent;
ALTER INDEX IF EXISTS idx_org_shares_child       RENAME TO idx_team_shares_child;

ALTER INDEX IF EXISTS idx_category_sets_org      RENAME TO idx_category_sets_team;
ALTER INDEX IF EXISTS idx_time_templates_org     RENAME TO idx_time_templates_team;
ALTER INDEX IF EXISTS expenses_org_date_idx      RENAME TO expenses_team_date_idx;

-- ============================================================
-- 4. Function renames (keep OIDs so RLS policies stay bound)
-- ============================================================

ALTER FUNCTION public.user_has_org_access(UUID)             RENAME TO user_has_team_access;
ALTER FUNCTION public.user_org_role(UUID)                   RENAME TO user_team_role;
ALTER FUNCTION public.create_organization(TEXT)             RENAME TO create_team;
ALTER FUNCTION public.user_can_see_cross_org_entries(UUID)  RENAME TO user_can_see_cross_team_entries;
ALTER FUNCTION public.propose_organization_share(UUID, UUID, TEXT) RENAME TO propose_team_share;
ALTER FUNCTION public.accept_organization_share(UUID)       RENAME TO accept_team_share;
ALTER FUNCTION public.change_customer_primary_org(UUID, UUID) RENAME TO change_customer_primary_team;

-- ============================================================
-- 5. Rewrite function bodies with team-named references
--    CREATE OR REPLACE keeps the OID (function was renamed above, so
--    policies already bound to it continue to work unchanged).
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_has_team_access(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.user_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_team_role(p_team_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT tm.role INTO result FROM public.team_members tm
    WHERE tm.team_id = p_team_id AND tm.user_id = auth.uid();
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team(p_team_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id UUID;
  new_slug TEXT;
  creator_id UUID;
BEGIN
  creator_id := auth.uid();

  IF creator_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_team_name IS NULL OR length(trim(p_team_name)) = 0 THEN
    RAISE EXCEPTION 'Team name is required';
  END IF;

  new_slug := lower(regexp_replace(trim(p_team_name), '[^a-z0-9]+', '-', 'gi'));
  new_slug := regexp_replace(new_slug, '(^-|-$)', '', 'g');
  new_slug := substring(new_slug, 1, 50) || '-' || extract(epoch from now())::text;

  INSERT INTO public.teams (name, slug, is_personal)
  VALUES (trim(p_team_name), new_slug, false)
  RETURNING id INTO new_team_id;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (new_team_id, creator_id, 'owner');

  INSERT INTO public.team_settings (team_id)
  VALUES (new_team_id);

  RETURN new_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_see_cross_team_entries(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  primary_team UUID;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT team_id INTO primary_team FROM public.customers WHERE id = p_customer_id;
  IF primary_team IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = uid AND team_id = primary_team
  ) THEN RETURN true; END IF;

  IF public.user_customer_permission(p_customer_id) = 'admin' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.customer_shares cs
    JOIN public.team_members tm ON tm.team_id = cs.team_id
    WHERE cs.customer_id = p_customer_id
      AND tm.user_id = uid
      AND cs.can_see_others_entries = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.propose_team_share(
  p_parent_team_id UUID,
  p_child_team_id UUID,
  p_sharing_level TEXT DEFAULT 'clients_read'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  new_share_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF public.user_team_role(p_parent_team_id) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners/admins can propose team shares from parent';
  END IF;

  INSERT INTO public.team_shares (parent_team_id, child_team_id, sharing_level, proposed_by)
  VALUES (p_parent_team_id, p_child_team_id, p_sharing_level, uid)
  RETURNING id INTO new_share_id;

  RETURN new_share_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_team_share(
  p_share_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  share_record RECORD;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO share_record FROM public.team_shares WHERE id = p_share_id;
  IF share_record IS NULL THEN RAISE EXCEPTION 'Share proposal not found'; END IF;
  IF share_record.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Already accepted'; END IF;

  IF public.user_team_role(share_record.child_team_id) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only child team owners/admins can accept';
  END IF;

  UPDATE public.team_shares SET accepted_at = now() WHERE id = p_share_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_customer_primary_team(
  p_customer_id UUID,
  p_new_team_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  current_primary UUID;
  primary_role TEXT;
  target_role TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT team_id INTO current_primary
    FROM public.customers WHERE id = p_customer_id;
  IF current_primary IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT tm.role INTO primary_role FROM public.team_members tm
    WHERE tm.team_id = current_primary AND tm.user_id = uid;
  IF primary_role IS NULL OR primary_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the current primary team owner can transfer';
  END IF;

  SELECT tm.role INTO target_role FROM public.team_members tm
    WHERE tm.team_id = p_new_team_id AND tm.user_id = uid;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'You must be a member of the target team';
  END IF;

  DELETE FROM public.customer_shares
    WHERE customer_id = p_customer_id AND team_id = p_new_team_id;

  UPDATE public.customers SET team_id = p_new_team_id WHERE id = p_customer_id;
  UPDATE public.projects  SET team_id = p_new_team_id WHERE customer_id = p_customer_id;

  INSERT INTO public.customer_shares (customer_id, team_id, can_see_others_entries, created_by)
  VALUES (p_customer_id, current_primary, true, uid)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Customer helpers referenced the old table/column names in their bodies.
CREATE OR REPLACE FUNCTION public.user_can_view_customer(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
  primary_team UUID;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  SELECT team_id INTO primary_team FROM public.customers WHERE id = p_customer_id;
  IF primary_team IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = uid AND team_id = primary_team
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_shares cs
    JOIN public.team_members tm ON tm.team_id = cs.team_id
    WHERE cs.customer_id = p_customer_id AND tm.user_id = uid
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_shares ts
    JOIN public.team_members tm ON tm.team_id = ts.child_team_id
    WHERE ts.parent_team_id = primary_team
      AND ts.accepted_at IS NOT NULL
      AND tm.user_id = uid
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_permissions
    WHERE customer_id = p_customer_id
      AND principal_type = 'user'
      AND principal_id = uid
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_permissions cp
    JOIN public.security_group_members sgm
      ON sgm.group_id = cp.principal_id AND cp.principal_type = 'group'
    WHERE cp.customer_id = p_customer_id AND sgm.user_id = uid
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_customer_permission(p_customer_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  primary_team UUID;
  primary_role TEXT;
  best TEXT;
BEGIN
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT team_id INTO primary_team FROM public.customers WHERE id = p_customer_id;
  IF primary_team IS NULL THEN RETURN NULL; END IF;

  SELECT tm.role INTO primary_role FROM public.team_members tm
    WHERE tm.team_id = primary_team AND tm.user_id = uid;
  IF primary_role IN ('owner', 'admin') THEN RETURN 'admin'; END IF;
  IF primary_role = 'member' THEN best := 'contributor'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_permissions
    WHERE customer_id = p_customer_id AND principal_type = 'user'
      AND principal_id = uid AND permission_level = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_permissions cp
    JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
    WHERE cp.customer_id = p_customer_id AND cp.principal_type = 'group'
      AND sgm.user_id = uid AND cp.permission_level = 'admin'
  ) THEN RETURN 'admin'; END IF;

  IF best IS NULL AND EXISTS (
    SELECT 1 FROM public.customer_shares cs
    JOIN public.team_members tm ON tm.team_id = cs.team_id
    WHERE cs.customer_id = p_customer_id AND tm.user_id = uid
  ) THEN best := 'contributor'; END IF;

  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.customer_permissions
      WHERE customer_id = p_customer_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'contributor'
    ) OR EXISTS (
      SELECT 1 FROM public.customer_permissions cp
      JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.customer_id = p_customer_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'contributor'
    )
  ) THEN best := 'contributor'; END IF;

  IF best IS NULL AND EXISTS (
    SELECT 1 FROM public.team_shares ts
    JOIN public.team_members tm ON tm.team_id = ts.child_team_id
    WHERE ts.parent_team_id = primary_team
      AND ts.accepted_at IS NOT NULL
      AND tm.user_id = uid
  ) THEN best := 'viewer'; END IF;

  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.customer_permissions
      WHERE customer_id = p_customer_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'viewer'
    ) OR EXISTS (
      SELECT 1 FROM public.customer_permissions cp
      JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.customer_id = p_customer_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'viewer'
    )
  ) THEN best := 'viewer'; END IF;

  RETURN best;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_customer_share(
  p_customer_id UUID,
  p_team_id UUID,
  p_can_see_others BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  new_share_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF public.user_customer_permission(p_customer_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only customer admins can add shares';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Cannot share with the primary team';
  END IF;

  INSERT INTO public.customer_shares
    (customer_id, team_id, can_see_others_entries, created_by)
  VALUES (p_customer_id, p_team_id, p_can_see_others, uid)
  RETURNING id INTO new_share_id;

  RETURN new_share_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_customer_permission(
  p_customer_id UUID,
  p_principal_type TEXT,
  p_principal_id UUID,
  p_level TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  new_perm_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF public.user_customer_permission(p_customer_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only customer admins can grant permissions';
  END IF;

  IF p_principal_type NOT IN ('user', 'group') THEN
    RAISE EXCEPTION 'principal_type must be user or group';
  END IF;

  IF p_level NOT IN ('viewer', 'contributor', 'admin') THEN
    RAISE EXCEPTION 'level must be viewer, contributor, or admin';
  END IF;

  INSERT INTO public.customer_permissions
    (customer_id, principal_type, principal_id, permission_level, granted_by)
  VALUES (p_customer_id, p_principal_type, p_principal_id, p_level, uid)
  ON CONFLICT (customer_id, principal_type, principal_id)
    DO UPDATE SET
      permission_level = EXCLUDED.permission_level,
      granted_by = uid,
      granted_at = now()
  RETURNING id INTO new_perm_id;

  RETURN new_perm_id;
END;
$$;

-- Signup trigger: team-named tables + "…'s Team" / "team-…" slug
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id UUID;
BEGIN
  INSERT INTO public.teams (name, slug, is_personal)
  VALUES (
    split_part(NEW.email, '@', 1) || '''s Team',
    'team-' || replace(NEW.id::text, '-', ''),
    true
  )
  RETURNING id INTO new_team_id;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (new_team_id, NEW.id, 'owner');

  INSERT INTO public.team_settings (team_id)
  VALUES (new_team_id);

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  INSERT INTO public.user_profiles (user_id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1));

  RETURN NEW;
END;
$$;

-- Security group member trigger — references team_id / team_members now.
CREATE OR REPLACE FUNCTION public.check_group_member_org()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  group_team UUID;
BEGIN
  SELECT team_id INTO group_team FROM public.security_groups WHERE id = NEW.group_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = NEW.user_id AND team_id = group_team
  ) THEN
    RAISE EXCEPTION 'User must be a member of the group''s team';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 6. Policy cleanup — drop & recreate any policy whose NAME carries
--    "org" / "organization" vocabulary with a team-named equivalent.
--    The underlying USING / WITH CHECK expressions already resolve to
--    the renamed columns/functions via Postgres's automatic rewrite on
--    table/column rename.
-- ============================================================

-- teams (was organizations)
DROP POLICY IF EXISTS "Members can view their organizations" ON public.teams;
DROP POLICY IF EXISTS "Owners can update their organizations" ON public.teams;
DROP POLICY IF EXISTS "Owners can delete their organizations" ON public.teams;
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.teams;

CREATE POLICY "teams_select" ON public.teams FOR SELECT
  USING (public.user_has_team_access(id));
CREATE POLICY "teams_insert" ON public.teams FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "teams_update" ON public.teams FOR UPDATE
  USING (public.user_team_role(id) = 'owner')
  WITH CHECK (public.user_team_role(id) = 'owner');
CREATE POLICY "teams_delete" ON public.teams FOR DELETE
  USING (public.user_team_role(id) = 'owner');

-- team_members (was organization_members)
DROP POLICY IF EXISTS "Members can view org members" ON public.team_members;
DROP POLICY IF EXISTS "Owners and admins can manage members" ON public.team_members;

CREATE POLICY "team_members_select" ON public.team_members FOR SELECT
  USING (public.user_has_team_access(team_id));
CREATE POLICY "team_members_manage" ON public.team_members FOR ALL
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

-- team_invites (was organization_invites)
DROP POLICY IF EXISTS "Owners and admins can manage invites" ON public.team_invites;
DROP POLICY IF EXISTS "Invited users can view their invite" ON public.team_invites;

CREATE POLICY "team_invites_manage" ON public.team_invites FOR ALL
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));
CREATE POLICY "team_invites_invitee_select" ON public.team_invites FOR SELECT
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- team_settings (was organization_settings)
DROP POLICY IF EXISTS "Org members can view settings" ON public.team_settings;
DROP POLICY IF EXISTS "Owners and admins can manage settings" ON public.team_settings;
DROP POLICY IF EXISTS "Owners and admins can update settings" ON public.team_settings;
DROP POLICY IF EXISTS "Owners can delete settings" ON public.team_settings;

CREATE POLICY "team_settings_select" ON public.team_settings FOR SELECT
  USING (public.user_has_team_access(team_id));
CREATE POLICY "team_settings_insert" ON public.team_settings FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));
CREATE POLICY "team_settings_update" ON public.team_settings FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));
CREATE POLICY "team_settings_delete" ON public.team_settings FOR DELETE
  USING (public.user_team_role(team_id) = 'owner');

-- team_shares (was organization_shares)
DROP POLICY IF EXISTS "org_shares_select" ON public.team_shares;
DROP POLICY IF EXISTS "org_shares_manage" ON public.team_shares;

CREATE POLICY "team_shares_select" ON public.team_shares FOR SELECT
  USING (
    public.user_has_team_access(parent_team_id)
    OR public.user_has_team_access(child_team_id)
  );
CREATE POLICY "team_shares_manage" ON public.team_shares FOR ALL
  USING (
    public.user_team_role(parent_team_id) IN ('owner', 'admin')
    OR public.user_team_role(child_team_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    public.user_team_role(parent_team_id) IN ('owner', 'admin')
    OR public.user_team_role(child_team_id) IN ('owner', 'admin')
  );

-- category_sets — original policy names mention "org"
DROP POLICY IF EXISTS "Anyone authenticated can read system sets" ON public.category_sets;
DROP POLICY IF EXISTS "Org members can read their category sets" ON public.category_sets;
DROP POLICY IF EXISTS "Org members can create category sets" ON public.category_sets;
DROP POLICY IF EXISTS "Org members can update their category sets" ON public.category_sets;
DROP POLICY IF EXISTS "Org members can delete their category sets" ON public.category_sets;

CREATE POLICY "category_sets_system_read" ON public.category_sets FOR SELECT
  USING (is_system = true AND auth.uid() IS NOT NULL);
CREATE POLICY "category_sets_team_read" ON public.category_sets FOR SELECT
  USING (team_id IS NOT NULL AND public.user_has_team_access(team_id));
CREATE POLICY "category_sets_team_insert" ON public.category_sets FOR INSERT
  WITH CHECK (
    is_system = false
    AND team_id IS NOT NULL
    AND public.user_has_team_access(team_id)
    AND created_by = auth.uid()
  );
CREATE POLICY "category_sets_team_update" ON public.category_sets FOR UPDATE
  USING (
    is_system = false
    AND team_id IS NOT NULL
    AND public.user_has_team_access(team_id)
  )
  WITH CHECK (
    is_system = false
    AND team_id IS NOT NULL
    AND public.user_has_team_access(team_id)
  );
CREATE POLICY "category_sets_team_delete" ON public.category_sets FOR DELETE
  USING (
    is_system = false
    AND team_id IS NOT NULL
    AND public.user_has_team_access(team_id)
  );

-- ============================================================
-- 7. Backfill auto-created names + slugs so they match the new vocabulary
-- ============================================================

UPDATE public.teams
SET name = REPLACE(name, '''s Organization', '''s Team')
WHERE name LIKE '%''s Organization';

UPDATE public.teams
SET slug = 'team-' || substring(slug FROM 5)
WHERE slug LIKE 'org-%';

-- ============================================================
-- 8. Grants for renamed functions
-- ============================================================

GRANT EXECUTE ON FUNCTION public.user_has_team_access(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_team_role(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team(TEXT)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_see_cross_team_entries(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_team_share(UUID, UUID, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_share(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_customer_primary_team(UUID, UUID) TO authenticated;
