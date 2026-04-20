-- Introduce Business as a first-class entity, distinct from Team.
--
-- Model change — until today a team WAS a business: legal identity
-- columns (legal_name, tax_id, etc.) lived on team_settings and every
-- team trivially stood in for one business. That conflation breaks the
-- moment a single user operates two LLCs, or an agency wants multiple
-- team-workspaces under one legal entity. Split:
--
--   businesses (NEW)         → legal identity (EIN, fiscal year, state)
--   teams                    → operational workspace (members, customers,
--                              projects). FKs to the business that owns it.
--   user_business_affiliations (NEW)
--                            → a user's "home business" for payroll /
--                              tax attribution. Explicit, not derived
--                              from team membership — a W-2 employee of
--                              Business A may legitimately collaborate
--                              on teams owned by Business B as a
--                              contractor. Informational identity only;
--                              does not grant authorization.
--
-- This migration is PR-1 of three:
--   PR-1 (this file): create businesses + affiliations, add
--                     teams.business_id, backfill, RLS helpers, rewrite
--                     handle_new_user / create_team.
--   PR-2: drop identity columns from team_settings; business/* reads/
--         writes switch to the businesses table.
--   PR-3: business_state_registrations + business_tax_registrations +
--         business_registered_agents (what originally prompted the
--         split — state registration is one-to-many by nature).
--
-- Authorization is derived through teams — a user is an owner/admin
-- of Business B iff they are an owner/admin of any team owned by B.
-- Affiliation is never checked for access; it is only displayed.

-- ============================================================
-- 1. businesses
-- ============================================================

CREATE TABLE public.businesses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Display name. Not the legal name — that comes later when the user
  -- fills in identity. For an auto-created shell at signup we seed this
  -- from the initial team's name, and the user can rename later.
  name                  TEXT NOT NULL,
  -- Identity columns — nullable, filled in by the user. Mirror exactly
  -- the columns that live on team_settings today; PR-2 drops them there.
  legal_name            TEXT,
  entity_type           TEXT
    CHECK (entity_type IS NULL OR entity_type IN (
      'sole_prop', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other'
    )),
  tax_id                TEXT,
  state_registration_id TEXT,
  registered_state      TEXT,
  date_incorporated     DATE,
  fiscal_year_start     TEXT
    CHECK (fiscal_year_start IS NULL OR fiscal_year_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.businesses IS 'Legal business entity. Owns one or more teams.';
COMMENT ON COLUMN public.businesses.name IS 'Display name (may differ from legal_name). Used in UI lists.';
COMMENT ON COLUMN public.businesses.legal_name IS 'Registered legal name as filed with the state.';
COMMENT ON COLUMN public.businesses.entity_type IS 'sole_prop|llc|s_corp|c_corp|partnership|nonprofit|other';

-- ============================================================
-- 2. teams.business_id
-- ============================================================

-- Nullable at first so the backfill below can populate it without
-- requiring a default. After backfill we tighten to NOT NULL.
ALTER TABLE public.teams
  ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE RESTRICT;

-- Backfill: one business per existing team, seeded from the team's
-- current identity (if any) on team_settings. The team name becomes
-- the business display name.
DO $$
DECLARE
  r RECORD;
  new_business_id UUID;
BEGIN
  FOR r IN
    SELECT
      t.id              AS team_id,
      t.name            AS team_name,
      ts.legal_name,
      ts.entity_type,
      ts.tax_id,
      ts.state_registration_id,
      ts.registered_state,
      ts.date_incorporated,
      ts.fiscal_year_start
    FROM public.teams t
    LEFT JOIN public.team_settings ts ON ts.team_id = t.id
  LOOP
    INSERT INTO public.businesses (
      name,
      legal_name,
      entity_type,
      tax_id,
      state_registration_id,
      registered_state,
      date_incorporated,
      fiscal_year_start
    ) VALUES (
      COALESCE(r.legal_name, r.team_name),
      r.legal_name,
      r.entity_type,
      r.tax_id,
      r.state_registration_id,
      r.registered_state,
      r.date_incorporated,
      r.fiscal_year_start
    )
    RETURNING id INTO new_business_id;

    UPDATE public.teams
      SET business_id = new_business_id
      WHERE id = r.team_id;
  END LOOP;
END $$;

-- Tighten: every team now belongs to exactly one business. No orphans.
ALTER TABLE public.teams
  ALTER COLUMN business_id SET NOT NULL;

CREATE INDEX idx_teams_business_id ON public.teams (business_id);

-- ============================================================
-- 3. user_business_affiliations
-- ============================================================
--
-- A user's "home business" — who they are employed by / contract
-- through, for payroll and tax attribution. Separate from team
-- membership. `is_primary = true` marks the one affiliation that
-- appears as the user's employer of record; only one is allowed per
-- user (partial unique index below).
--
-- affiliation_role is informational, not auth-gated — `owner` /
-- `employee` / `contractor` / `partner` cover the common 1099-MISC
-- vs W-2 vs founder split. Named `affiliation_role` (not `role`) to
-- avoid collision with team_members.role in db-parity.test.ts's
-- column-name extractor. Owners/admins of a team do their editing
-- via team_members (see user_business_role() below).

CREATE TABLE public.user_business_affiliations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  affiliation_role  TEXT NOT NULL CHECK (affiliation_role IN (
                      'owner', 'employee', 'contractor', 'partner'
                    )),
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  started_on        DATE,
  ended_on          DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_id),
  CONSTRAINT uba_ended_after_started CHECK (
    ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on
  )
);

-- At most one primary affiliation per user. Partial unique index lets
-- a user toggle primaries without needing to null the old one in the
-- same transaction (app code flips a single row to primary; the old
-- one flips to non-primary via an UPDATE just before).
CREATE UNIQUE INDEX uba_one_primary_per_user
  ON public.user_business_affiliations (user_id)
  WHERE is_primary = true;

CREATE INDEX idx_uba_user    ON public.user_business_affiliations (user_id);
CREATE INDEX idx_uba_business ON public.user_business_affiliations (business_id);

-- Backfill: every existing user gets a primary affiliation to the
-- business that owns the first team they belong to (lowest-id team,
-- for determinism).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (tm.user_id)
      tm.user_id,
      t.business_id
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    ORDER BY tm.user_id, tm.joined_at ASC, tm.id ASC
  LOOP
    INSERT INTO public.user_business_affiliations (
      user_id, business_id, affiliation_role, is_primary
    ) VALUES (
      r.user_id, r.business_id, 'owner', true
    )
    ON CONFLICT (user_id, business_id) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- 4. RLS helpers — derive business access through teams
-- ============================================================
--
-- A user "has access to" a business if they are a member of any team
-- that business owns. Their role on the business is the MAX role
-- across those team memberships (owner > admin > member). This
-- matches the intuition that a bookkeeper who is an admin of Team A
-- should be able to edit Business A's legal identity, even if they
-- are only a plain member of Team A's sibling team in the same
-- business.

CREATE OR REPLACE FUNCTION public.user_has_business_access(business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE t.business_id = user_has_business_access.business_id
      AND tm.user_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_business_role(business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  best TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  -- Pick the strongest role across all team memberships owned by this
  -- business. owner > admin > member. If the user is not a member of
  -- any team in this business, return NULL.
  SELECT tm.role INTO best
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE t.business_id = user_business_role.business_id
      AND tm.user_id = auth.uid()
    ORDER BY
      CASE tm.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        ELSE 3
      END
    LIMIT 1;

  RETURN best;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_business_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_business_role(UUID)       TO authenticated;

-- ============================================================
-- 5. RLS on new tables
-- ============================================================

ALTER TABLE public.businesses                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_business_affiliations ENABLE ROW LEVEL SECURITY;

-- businesses: readable by any member of any team owned by it; editable
-- by team owners/admins (derived via user_business_role).
CREATE POLICY "businesses_select" ON public.businesses FOR SELECT
  USING (public.user_has_business_access(id));

CREATE POLICY "businesses_insert" ON public.businesses FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "businesses_update" ON public.businesses FOR UPDATE
  USING (public.user_business_role(id) IN ('owner', 'admin'))
  WITH CHECK (public.user_business_role(id) IN ('owner', 'admin'));

CREATE POLICY "businesses_delete" ON public.businesses FOR DELETE
  USING (public.user_business_role(id) = 'owner');

-- user_business_affiliations: a user can see their own affiliations,
-- and business owners/admins can see all affiliations for their
-- business (e.g. People tab). Users can insert/update/delete their
-- OWN affiliations; business owners/admins can insert/update/delete
-- any affiliation for their business.
CREATE POLICY "uba_select_own" ON public.user_business_affiliations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "uba_select_biz_admin" ON public.user_business_affiliations FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "uba_insert" ON public.user_business_affiliations FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.user_business_role(business_id) IN ('owner', 'admin')
  );

CREATE POLICY "uba_update" ON public.user_business_affiliations FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.user_business_role(business_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.user_business_role(business_id) IN ('owner', 'admin')
  );

CREATE POLICY "uba_delete" ON public.user_business_affiliations FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.user_business_role(business_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 6. Team re-parent guard
-- ============================================================
--
-- Moving a team from one business to another silently re-attributes
-- every future invoice / expense issued under that team to a different
-- legal entity — a bookkeeping bug that's impossible to catch after
-- the fact. Block the move once the team has recorded ledger activity
-- (invoices or expenses). A team that's still empty can be re-parented
-- freely; once you've billed a customer, the business_id on that team
-- is effectively immutable.
--
-- Invoices carry their own business_id snapshot (added in PR-2) for
-- historical stability; this trigger protects *future* rows from
-- drifting away from the invoices already written.

CREATE OR REPLACE FUNCTION public.guard_teams_business_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    IF EXISTS (SELECT 1 FROM public.invoices WHERE team_id = OLD.id LIMIT 1)
       OR EXISTS (SELECT 1 FROM public.expenses WHERE team_id = OLD.id LIMIT 1) THEN
      RAISE EXCEPTION
        'Cannot change business_id on team % — team has recorded ledger activity. Split the team instead.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_teams_business_id_guard
  BEFORE UPDATE OF business_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_teams_business_id();

-- ============================================================
-- 7. Rewrite handle_new_user: shell business → team → affiliation
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_business_id UUID;
  new_team_id     UUID;
  display_slug    TEXT;
BEGIN
  display_slug := split_part(NEW.email, '@', 1);

  -- 1. Shell business — identity is NULL until the user fills it in.
  INSERT INTO public.businesses (name)
  VALUES (display_slug || '''s Business')
  RETURNING id INTO new_business_id;

  -- 2. Personal team, owned by the shell business.
  INSERT INTO public.teams (name, slug, is_personal, business_id)
  VALUES (
    display_slug || '''s Team',
    'team-' || replace(NEW.id::text, '-', ''),
    true,
    new_business_id
  )
  RETURNING id INTO new_team_id;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (new_team_id, NEW.id, 'owner');

  INSERT INTO public.team_settings (team_id)
  VALUES (new_team_id);

  -- 3. Primary affiliation — this is the user's home business.
  INSERT INTO public.user_business_affiliations (
    user_id, business_id, affiliation_role, is_primary
  ) VALUES (
    NEW.id, new_business_id, 'owner', true
  );

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  INSERT INTO public.user_profiles (user_id, display_name)
  VALUES (NEW.id, display_slug);

  RETURN NEW;
END;
$$;

-- ============================================================
-- 8. Rewrite create_team: existing-business or auto-create
-- ============================================================
--
-- Two patterns:
--   (a) Caller passes p_business_id — new team joins that business.
--       Caller must already be an owner/admin of at least one team
--       in that business (enforced here via user_business_role).
--   (b) Caller passes NULL — create a shell business for this team.
--       Equivalent to "quick-create a new workspace" from the teams
--       index page, carries the semantics of a fresh legal entity.

DROP FUNCTION IF EXISTS public.create_team(TEXT);
DROP FUNCTION IF EXISTS public.create_team(TEXT, UUID);

CREATE FUNCTION public.create_team(
  team_name    TEXT,
  p_business_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id     UUID;
  new_business_id UUID;
  new_slug        TEXT;
  creator_id      UUID;
BEGIN
  creator_id := auth.uid();

  IF creator_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF team_name IS NULL OR length(trim(team_name)) = 0 THEN
    RAISE EXCEPTION 'Team name is required';
  END IF;

  -- Resolve target business. If caller specified one, verify they
  -- have owner/admin access; otherwise auto-create a shell.
  IF p_business_id IS NOT NULL THEN
    IF public.user_business_role(p_business_id) NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'You must be an owner or admin of a team in the target business to add a new team';
    END IF;
    new_business_id := p_business_id;
  ELSE
    INSERT INTO public.businesses (name)
    VALUES (trim(team_name))
    RETURNING id INTO new_business_id;

    -- Caller owns the new shell business via the team they're about
    -- to create; and they get a primary affiliation if they don't
    -- already have one.
    INSERT INTO public.user_business_affiliations (
      user_id, business_id, affiliation_role, is_primary
    ) VALUES (
      creator_id, new_business_id, 'owner', NOT EXISTS (
        SELECT 1 FROM public.user_business_affiliations
         WHERE user_id = creator_id AND is_primary = true
      )
    )
    ON CONFLICT (user_id, business_id) DO NOTHING;
  END IF;

  new_slug := lower(regexp_replace(trim(team_name), '[^a-z0-9]+', '-', 'gi'));
  new_slug := regexp_replace(new_slug, '(^-|-$)', '', 'g');
  new_slug := substring(new_slug, 1, 50) || '-' || extract(epoch from now())::text;

  INSERT INTO public.teams (name, slug, is_personal, business_id)
  VALUES (trim(team_name), new_slug, false, new_business_id)
  RETURNING id INTO new_team_id;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (new_team_id, creator_id, 'owner');

  INSERT INTO public.team_settings (team_id)
  VALUES (new_team_id);

  RETURN new_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_team(TEXT, UUID) TO authenticated;

-- ============================================================
-- 9. updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_uba_updated_at
  BEFORE UPDATE ON public.user_business_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
