-- Multi-Org Resource Sharing, Security Groups & Granular Permissions
--
-- Enables:
-- - Shared clients across multiple orgs (primary + participating)
-- - Security groups (user bundles within an org)
-- - Granular per-client permissions (viewer/contributor/admin)
-- - Parent/child organization relationships
--
-- Backward compatible: with no rows in the new tables, behavior matches
-- the previous single-org model exactly.

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

-- Security groups: bundle users within an org for permission grants
CREATE TABLE security_groups (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE security_group_members (
  group_id   UUID REFERENCES security_groups(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  added_by   UUID REFERENCES auth.users(id),
  added_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Client shares: additional orgs participating on a client
CREATE TABLE client_shares (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id              UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  organization_id        UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  can_see_others_entries BOOLEAN NOT NULL DEFAULT false,
  created_by             UUID REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, organization_id)
);

-- Organization shares: parent/child relationships between orgs
CREATE TABLE organization_shares (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_org_id  UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  child_org_id   UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  sharing_level  TEXT NOT NULL DEFAULT 'clients_read'
                   CHECK (sharing_level IN ('clients_read', 'clients_participate')),
  accepted_at    TIMESTAMPTZ,
  proposed_by    UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (parent_org_id, child_org_id),
  CHECK (parent_org_id <> child_org_id)
);

-- Client permissions: per-client grants to specific users or groups
CREATE TABLE client_permissions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id        UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  principal_type   TEXT NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id     UUID NOT NULL,
  permission_level TEXT NOT NULL CHECK (permission_level IN ('viewer', 'contributor', 'admin')),
  granted_by       UUID REFERENCES auth.users(id),
  granted_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, principal_type, principal_id)
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_security_groups_org ON security_groups(organization_id);
CREATE INDEX idx_sg_members_user ON security_group_members(user_id);
CREATE INDEX idx_sg_members_group ON security_group_members(group_id);

CREATE INDEX idx_client_shares_client ON client_shares(client_id);
CREATE INDEX idx_client_shares_org ON client_shares(organization_id);

CREATE INDEX idx_org_shares_parent ON organization_shares(parent_org_id);
CREATE INDEX idx_org_shares_child ON organization_shares(child_org_id);

CREATE INDEX idx_client_perms_client ON client_permissions(client_id);
CREATE INDEX idx_client_perms_user ON client_permissions(principal_id) WHERE principal_type = 'user';
CREATE INDEX idx_client_perms_group ON client_permissions(principal_id) WHERE principal_type = 'group';

-- ============================================================
-- 3. HELPER FUNCTIONS
-- ============================================================

-- Check if current user can view a client through any path
CREATE OR REPLACE FUNCTION public.user_can_view_client(p_client_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  uid UUID := auth.uid();
  primary_org UUID;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  SELECT organization_id INTO primary_org FROM clients WHERE id = p_client_id;
  IF primary_org IS NULL THEN RETURN false; END IF;

  -- Path 1: member of primary org
  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = uid AND organization_id = primary_org
  ) THEN RETURN true; END IF;

  -- Path 2: member of a participating org
  IF EXISTS (
    SELECT 1 FROM client_shares cs
    JOIN organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.client_id = p_client_id AND om.user_id = uid
  ) THEN RETURN true; END IF;

  -- Path 3: member of a child org via accepted organization_shares
  IF EXISTS (
    SELECT 1 FROM organization_shares os
    JOIN organization_members om ON om.organization_id = os.child_org_id
    WHERE os.parent_org_id = primary_org
      AND os.accepted_at IS NOT NULL
      AND om.user_id = uid
  ) THEN RETURN true; END IF;

  -- Path 4: direct user permission grant
  IF EXISTS (
    SELECT 1 FROM client_permissions
    WHERE client_id = p_client_id
      AND principal_type = 'user'
      AND principal_id = uid
  ) THEN RETURN true; END IF;

  -- Path 5: security group membership with grant
  IF EXISTS (
    SELECT 1 FROM client_permissions cp
    JOIN security_group_members sgm
      ON sgm.group_id = cp.principal_id AND cp.principal_type = 'group'
    WHERE cp.client_id = p_client_id AND sgm.user_id = uid
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Return highest permission level: 'admin' > 'contributor' > 'viewer' > NULL
CREATE OR REPLACE FUNCTION public.user_client_permission(p_client_id UUID)
RETURNS TEXT AS $$
DECLARE
  uid UUID := auth.uid();
  primary_org UUID;
  primary_role TEXT;
  best TEXT;
BEGIN
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT organization_id INTO primary_org FROM clients WHERE id = p_client_id;
  IF primary_org IS NULL THEN RETURN NULL; END IF;

  -- Primary org member: owner/admin → admin; member → contributor
  SELECT role INTO primary_role FROM organization_members
    WHERE organization_id = primary_org AND user_id = uid;
  IF primary_role IN ('owner', 'admin') THEN RETURN 'admin'; END IF;
  IF primary_role = 'member' THEN best := 'contributor'; END IF;

  -- Check explicit admin grant (user or group)
  IF EXISTS (
    SELECT 1 FROM client_permissions
    WHERE client_id = p_client_id AND principal_type = 'user'
      AND principal_id = uid AND permission_level = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM client_permissions cp
    JOIN security_group_members sgm ON sgm.group_id = cp.principal_id
    WHERE cp.client_id = p_client_id AND cp.principal_type = 'group'
      AND sgm.user_id = uid AND cp.permission_level = 'admin'
  ) THEN RETURN 'admin'; END IF;

  -- Participating org member → contributor baseline
  IF best IS NULL AND EXISTS (
    SELECT 1 FROM client_shares cs
    JOIN organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.client_id = p_client_id AND om.user_id = uid
  ) THEN best := 'contributor'; END IF;

  -- Explicit contributor grant
  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM client_permissions
      WHERE client_id = p_client_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'contributor'
    ) OR EXISTS (
      SELECT 1 FROM client_permissions cp
      JOIN security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.client_id = p_client_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'contributor'
    )
  ) THEN best := 'contributor'; END IF;

  -- Child org via organization_shares → viewer baseline
  IF best IS NULL AND EXISTS (
    SELECT 1 FROM organization_shares os
    JOIN organization_members om ON om.organization_id = os.child_org_id
    WHERE os.parent_org_id = primary_org
      AND os.accepted_at IS NOT NULL
      AND om.user_id = uid
  ) THEN best := 'viewer'; END IF;

  -- Explicit viewer grant
  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM client_permissions
      WHERE client_id = p_client_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'viewer'
    ) OR EXISTS (
      SELECT 1 FROM client_permissions cp
      JOIN security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.client_id = p_client_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'viewer'
    )
  ) THEN best := 'viewer'; END IF;

  RETURN best;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Can user see cross-org time entries on a shared client?
CREATE OR REPLACE FUNCTION public.user_can_see_cross_org_entries(p_client_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  uid UUID := auth.uid();
  primary_org UUID;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT organization_id INTO primary_org FROM clients WHERE id = p_client_id;
  IF primary_org IS NULL THEN RETURN false; END IF;

  -- Primary org members see all
  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = uid AND organization_id = primary_org
  ) THEN RETURN true; END IF;

  -- Client admins see all
  IF public.user_client_permission(p_client_id) = 'admin' THEN
    RETURN true;
  END IF;

  -- Participating orgs see all if share config allows
  RETURN EXISTS (
    SELECT 1 FROM client_shares cs
    JOIN organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.client_id = p_client_id
      AND om.user_id = uid
      AND cs.can_see_others_entries = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- 4. RLS ON NEW TABLES
-- ============================================================

ALTER TABLE security_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_permissions ENABLE ROW LEVEL SECURITY;

-- Security groups: org members view, owners/admins manage
CREATE POLICY "security_groups_select" ON security_groups FOR SELECT
  USING (public.user_has_org_access(organization_id));

CREATE POLICY "security_groups_insert" ON security_groups FOR INSERT
  WITH CHECK (public.user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "security_groups_update" ON security_groups FOR UPDATE
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "security_groups_delete" ON security_groups FOR DELETE
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'));

-- Group members: visible to org members, managed by owners/admins
CREATE POLICY "sg_members_select" ON security_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM security_groups sg
    WHERE sg.id = group_id AND public.user_has_org_access(sg.organization_id)
  ));

CREATE POLICY "sg_members_manage" ON security_group_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM security_groups sg
    WHERE sg.id = group_id
      AND public.user_org_role(sg.organization_id) IN ('owner', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM security_groups sg
    WHERE sg.id = group_id
      AND public.user_org_role(sg.organization_id) IN ('owner', 'admin')
  ));

-- Client shares: viewable by anyone who can view client, managed by client admin
CREATE POLICY "client_shares_select" ON client_shares FOR SELECT
  USING (public.user_can_view_client(client_id));

CREATE POLICY "client_shares_manage" ON client_shares FOR ALL
  USING (public.user_client_permission(client_id) = 'admin')
  WITH CHECK (public.user_client_permission(client_id) = 'admin');

-- Organization shares: visible to members of either side, managed by parent-side owners/admins
CREATE POLICY "org_shares_select" ON organization_shares FOR SELECT
  USING (
    public.user_has_org_access(parent_org_id)
    OR public.user_has_org_access(child_org_id)
  );

CREATE POLICY "org_shares_manage" ON organization_shares FOR ALL
  USING (
    public.user_org_role(parent_org_id) IN ('owner', 'admin')
    OR public.user_org_role(child_org_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    public.user_org_role(parent_org_id) IN ('owner', 'admin')
    OR public.user_org_role(child_org_id) IN ('owner', 'admin')
  );

-- Client permissions: viewable by viewers, managed by client admin
CREATE POLICY "client_permissions_select" ON client_permissions FOR SELECT
  USING (public.user_can_view_client(client_id));

CREATE POLICY "client_permissions_manage" ON client_permissions FOR ALL
  USING (public.user_client_permission(client_id) = 'admin')
  WITH CHECK (public.user_client_permission(client_id) = 'admin');

-- ============================================================
-- 5. ENFORCE SECURITY GROUP ORG SCOPE
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_group_member_org()
RETURNS TRIGGER AS $$
DECLARE
  group_org UUID;
BEGIN
  SELECT organization_id INTO group_org FROM security_groups WHERE id = NEW.group_id;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = NEW.user_id AND organization_id = group_org
  ) THEN
    RAISE EXCEPTION 'User must be a member of the group''s organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_group_member_org
  BEFORE INSERT OR UPDATE ON security_group_members
  FOR EACH ROW EXECUTE FUNCTION public.check_group_member_org();

-- ============================================================
-- 6. REPLACE RESOURCE RLS POLICIES
-- ============================================================

-- CLIENTS: split policies using new helpers
DROP POLICY IF EXISTS "Org members manage clients" ON clients;

CREATE POLICY "clients_select" ON clients FOR SELECT
  USING (public.user_can_view_client(id));

CREATE POLICY "clients_insert" ON clients FOR INSERT
  WITH CHECK (public.user_has_org_access(organization_id));

CREATE POLICY "clients_update" ON clients FOR UPDATE
  USING (public.user_client_permission(id) = 'admin')
  WITH CHECK (public.user_client_permission(id) = 'admin');

CREATE POLICY "clients_delete" ON clients FOR DELETE
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'));

-- PROJECTS: inherits client permissions; internal (null client) stays org-scoped
DROP POLICY IF EXISTS "Org members manage projects" ON projects;

CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  (client_id IS NULL AND public.user_has_org_access(organization_id))
  OR (client_id IS NOT NULL AND public.user_can_view_client(client_id))
);

CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (
  (client_id IS NULL AND public.user_has_org_access(organization_id))
  OR (client_id IS NOT NULL AND public.user_client_permission(client_id) = 'admin')
);

CREATE POLICY "projects_update" ON projects FOR UPDATE USING (
  (client_id IS NULL AND public.user_org_role(organization_id) IN ('owner', 'admin'))
  OR (client_id IS NOT NULL AND public.user_client_permission(client_id) = 'admin')
);

CREATE POLICY "projects_delete" ON projects FOR DELETE USING (
  (client_id IS NULL AND public.user_org_role(organization_id) IN ('owner', 'admin'))
  OR (client_id IS NOT NULL AND public.user_client_permission(client_id) = 'admin')
);

-- TIME_ENTRIES: own entries, org entries, or cross-org shared via config
DROP POLICY IF EXISTS "Org members manage time entries" ON time_entries;

CREATE POLICY "time_entries_select" ON time_entries FOR SELECT USING (
  user_id = auth.uid()
  OR public.user_has_org_access(organization_id)
  OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = time_entries.project_id
      AND p.client_id IS NOT NULL
      AND public.user_can_see_cross_org_entries(p.client_id)
  )
);

CREATE POLICY "time_entries_insert" ON time_entries FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND public.user_has_org_access(organization_id)
  AND (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.client_id IS NULL
        AND p.organization_id = time_entries.organization_id
    )
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.client_id IS NOT NULL
        AND public.user_client_permission(p.client_id) IN ('contributor', 'admin')
    )
  )
);

CREATE POLICY "time_entries_update" ON time_entries FOR UPDATE USING (
  user_id = auth.uid()
  OR public.user_org_role(organization_id) IN ('owner', 'admin')
  OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = time_entries.project_id
      AND p.client_id IS NOT NULL
      AND public.user_client_permission(p.client_id) = 'admin'
  )
);

CREATE POLICY "time_entries_delete" ON time_entries FOR DELETE USING (
  user_id = auth.uid()
  OR public.user_org_role(organization_id) IN ('owner', 'admin')
);

-- INVOICES: primary org only (prevents double-billing on shared clients)
DROP POLICY IF EXISTS "Org members manage invoices" ON invoices;

CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (
  public.user_has_org_access(organization_id)
  OR (client_id IS NOT NULL AND public.user_client_permission(client_id) = 'admin')
);

CREATE POLICY "invoices_insert" ON invoices FOR INSERT WITH CHECK (
  public.user_has_org_access(organization_id)
  AND (
    client_id IS NULL
    OR EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id AND c.organization_id = invoices.organization_id
    )
  )
);

CREATE POLICY "invoices_update" ON invoices FOR UPDATE
  USING (public.user_has_org_access(organization_id));

CREATE POLICY "invoices_delete" ON invoices FOR DELETE
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'));

-- ============================================================
-- 7. SECURITY DEFINER MULTI-ROW OPERATIONS
-- ============================================================

-- Add a participating org to a client
CREATE OR REPLACE FUNCTION public.add_client_share(
  p_client_id UUID,
  p_org_id UUID,
  p_can_see_others BOOLEAN DEFAULT false
) RETURNS UUID AS $$
DECLARE
  uid UUID := auth.uid();
  new_share_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF public.user_client_permission(p_client_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only client admins can add shares';
  END IF;

  -- Must not duplicate the primary org
  IF EXISTS (SELECT 1 FROM clients WHERE id = p_client_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Cannot share with the primary organization';
  END IF;

  INSERT INTO client_shares (client_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_client_id, p_org_id, p_can_see_others, uid)
  RETURNING id INTO new_share_id;

  RETURN new_share_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant a permission on a client
CREATE OR REPLACE FUNCTION public.grant_client_permission(
  p_client_id UUID,
  p_principal_type TEXT,
  p_principal_id UUID,
  p_level TEXT
) RETURNS UUID AS $$
DECLARE
  uid UUID := auth.uid();
  new_perm_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF public.user_client_permission(p_client_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only client admins can grant permissions';
  END IF;

  IF p_principal_type NOT IN ('user', 'group') THEN
    RAISE EXCEPTION 'principal_type must be user or group';
  END IF;

  IF p_level NOT IN ('viewer', 'contributor', 'admin') THEN
    RAISE EXCEPTION 'level must be viewer, contributor, or admin';
  END IF;

  INSERT INTO client_permissions (client_id, principal_type, principal_id, permission_level, granted_by)
  VALUES (p_client_id, p_principal_type, p_principal_id, p_level, uid)
  ON CONFLICT (client_id, principal_type, principal_id)
    DO UPDATE SET permission_level = EXCLUDED.permission_level, granted_by = uid, granted_at = now()
  RETURNING id INTO new_perm_id;

  RETURN new_perm_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Change primary org on a client (transfers ownership, adds old primary as participant)
CREATE OR REPLACE FUNCTION public.change_client_primary_org(
  p_client_id UUID,
  p_new_org_id UUID
) RETURNS VOID AS $$
DECLARE
  uid UUID := auth.uid();
  current_primary UUID;
  current_role TEXT;
  new_role TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT organization_id INTO current_primary FROM clients WHERE id = p_client_id;
  IF current_primary IS NULL THEN RAISE EXCEPTION 'Client not found'; END IF;

  -- Must be owner of current primary
  SELECT role INTO current_role FROM organization_members
    WHERE organization_id = current_primary AND user_id = uid;
  IF current_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the current primary org owner can transfer';
  END IF;

  -- Must be member of target org
  SELECT role INTO new_role FROM organization_members
    WHERE organization_id = p_new_org_id AND user_id = uid;
  IF new_role IS NULL THEN
    RAISE EXCEPTION 'You must be a member of the target organization';
  END IF;

  -- Remove any existing share for the new primary (it's being promoted)
  DELETE FROM client_shares WHERE client_id = p_client_id AND organization_id = p_new_org_id;

  -- Update primary
  UPDATE clients SET organization_id = p_new_org_id WHERE id = p_client_id;

  -- Also update projects' organization_id to match new primary
  UPDATE projects SET organization_id = p_new_org_id WHERE client_id = p_client_id;

  -- Add old primary as participant (so their time entries continue to make sense)
  INSERT INTO client_shares (client_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_client_id, current_primary, true, uid)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Propose an organization share (creates a pending proposal)
CREATE OR REPLACE FUNCTION public.propose_organization_share(
  p_parent_org_id UUID,
  p_child_org_id UUID,
  p_sharing_level TEXT DEFAULT 'clients_read'
) RETURNS UUID AS $$
DECLARE
  uid UUID := auth.uid();
  new_share_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- Proposer must be owner/admin of parent
  IF public.user_org_role(p_parent_org_id) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners/admins can propose org shares from parent';
  END IF;

  INSERT INTO organization_shares (parent_org_id, child_org_id, sharing_level, proposed_by)
  VALUES (p_parent_org_id, p_child_org_id, p_sharing_level, uid)
  RETURNING id INTO new_share_id;

  RETURN new_share_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Accept an organization share (child-side accept)
CREATE OR REPLACE FUNCTION public.accept_organization_share(
  p_share_id UUID
) RETURNS VOID AS $$
DECLARE
  uid UUID := auth.uid();
  share_record RECORD;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO share_record FROM organization_shares WHERE id = p_share_id;
  IF share_record IS NULL THEN RAISE EXCEPTION 'Share proposal not found'; END IF;
  IF share_record.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Already accepted'; END IF;

  IF public.user_org_role(share_record.child_org_id) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only child org owners/admins can accept';
  END IF;

  UPDATE organization_shares SET accepted_at = now() WHERE id = p_share_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.user_can_view_client(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_client_permission(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_see_cross_org_entries(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_client_share(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_client_permission(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_client_primary_org(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_organization_share(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_share(UUID) TO authenticated;
