-- Stint: Multi-tenant Migration
-- Adds organizations, membership, invites, and re-scopes all data by org.

-- Enable pgcrypto for secure token generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

CREATE TABLE organizations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE organization_members (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE organization_invites (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by      UUID REFERENCES auth.users(id) NOT NULL,
  token           TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, email)
);

-- ============================================================
-- 2. ADD organization_id TO EXISTING TABLES
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE clients
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE projects
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE time_entries
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE invoices
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- ============================================================
-- 3. MIGRATE EXISTING DATA
-- Create a personal org for each existing user and assign their data.
-- ============================================================

DO $$
DECLARE
  r RECORD;
  new_org_id UUID;
BEGIN
  FOR r IN SELECT DISTINCT id, email FROM auth.users LOOP
    -- Create personal org
    INSERT INTO organizations (name, slug)
    VALUES (
      split_part(r.email, '@', 1) || '''s Organization',
      'org-' || replace(r.id::text, '-', '')
    )
    RETURNING id INTO new_org_id;

    -- Make user the owner
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (new_org_id, r.id, 'owner');

    -- Assign existing data to this org
    UPDATE user_settings SET organization_id = new_org_id WHERE user_id = r.id;
    UPDATE clients SET organization_id = new_org_id WHERE user_id = r.id;
    UPDATE projects SET organization_id = new_org_id WHERE user_id = r.id;
    UPDATE time_entries SET organization_id = new_org_id WHERE user_id = r.id;
    UPDATE invoices SET organization_id = new_org_id WHERE user_id = r.id;
  END LOOP;
END $$;

-- ============================================================
-- 4. MAKE organization_id NOT NULL (after data migration)
-- ============================================================

ALTER TABLE clients ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE time_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 5. INDEXES
-- ============================================================

CREATE INDEX idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX idx_org_invites_token ON organization_invites(token);
CREATE INDEX idx_org_invites_email ON organization_invites(email);
CREATE INDEX idx_clients_org_id ON clients(organization_id);
CREATE INDEX idx_projects_org_id ON projects(organization_id);
CREATE INDEX idx_time_entries_org_id ON time_entries(organization_id);
CREATE INDEX idx_invoices_org_id ON invoices(organization_id);

-- ============================================================
-- 6. HELPER FUNCTION: check org membership
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_has_org_access(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.user_org_role(org_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT role FROM organization_members
    WHERE organization_id = org_id
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- 7. RLS ON NEW TABLES
-- ============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

-- Organizations: members can view their orgs
CREATE POLICY "Members can view their organizations"
  ON organizations FOR SELECT
  USING (public.user_has_org_access(id));

-- Organizations: only owners can update
CREATE POLICY "Owners can update their organizations"
  ON organizations FOR UPDATE
  USING (public.user_org_role(id) = 'owner')
  WITH CHECK (public.user_org_role(id) = 'owner');

-- Organization members: members can view their org's members
CREATE POLICY "Members can view org members"
  ON organization_members FOR SELECT
  USING (public.user_has_org_access(organization_id));

-- Organization members: owners and admins can manage members
CREATE POLICY "Owners and admins can manage members"
  ON organization_members FOR ALL
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_org_role(organization_id) IN ('owner', 'admin'));

-- Invites: owners and admins can manage invites
CREATE POLICY "Owners and admins can manage invites"
  ON organization_invites FOR ALL
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_org_role(organization_id) IN ('owner', 'admin'));

-- Invites: invited users can view their own invite (by email match)
CREATE POLICY "Invited users can view their invite"
  ON organization_invites FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ============================================================
-- 8. UPDATE EXISTING RLS POLICIES (drop old, create new)
-- ============================================================

-- Clients
DROP POLICY "Users manage own clients" ON clients;
CREATE POLICY "Org members manage clients"
  ON clients FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

-- Projects
DROP POLICY "Users manage own projects" ON projects;
CREATE POLICY "Org members manage projects"
  ON projects FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

-- Time entries
DROP POLICY "Users manage own time entries" ON time_entries;
CREATE POLICY "Org members manage time entries"
  ON time_entries FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

-- Invoices
DROP POLICY "Users manage own invoices" ON invoices;
CREATE POLICY "Org members manage invoices"
  ON invoices FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

-- Invoice line items (unchanged — still checks parent invoice)
-- Already scoped through the invoices policy

-- User settings
DROP POLICY "Users manage own settings" ON user_settings;
CREATE POLICY "Org members manage settings"
  ON user_settings FOR ALL
  USING (public.user_has_org_access(organization_id))
  WITH CHECK (public.user_has_org_access(organization_id));

-- ============================================================
-- 9. UPDATE SIGNUP TRIGGER
-- Auto-create personal org + user_settings on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create personal organization
  INSERT INTO organizations (name, slug)
  VALUES (
    split_part(NEW.email, '@', 1) || '''s Organization',
    'org-' || replace(NEW.id::text, '-', '')
  )
  RETURNING id INTO new_org_id;

  -- Make user the owner
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  -- Create user settings scoped to org
  INSERT INTO public.user_settings (user_id, organization_id)
  VALUES (NEW.id, new_org_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
