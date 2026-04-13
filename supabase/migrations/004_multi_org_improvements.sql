-- Multi-Org Improvements
-- Adds org-scoped settings, user profiles, personal org flag,
-- and cleans up user_settings to be user-only.

-- ============================================================
-- 1. ADD is_personal FLAG TO ORGANIZATIONS
-- ============================================================

ALTER TABLE organizations ADD COLUMN is_personal BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark existing auto-created orgs as personal
UPDATE organizations
SET is_personal = true
WHERE slug LIKE 'org-%';

-- ============================================================
-- 2. ORGANIZATION SETTINGS (org-scoped business info)
-- ============================================================

CREATE TABLE organization_settings (
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE PRIMARY KEY,
  business_name    TEXT,
  business_email   TEXT,
  business_address TEXT,
  business_phone   TEXT,
  logo_url         TEXT,
  default_rate     NUMERIC(10,2) DEFAULT 0,
  invoice_prefix   TEXT DEFAULT 'INV',
  invoice_next_num INTEGER DEFAULT 1,
  tax_rate         NUMERIC(5,2) DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view settings"
  ON organization_settings FOR SELECT
  USING (public.user_has_org_access(organization_id));

CREATE POLICY "Owners and admins can manage settings"
  ON organization_settings FOR INSERT
  WITH CHECK (public.user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "Owners and admins can update settings"
  ON organization_settings FOR UPDATE
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "Owners can delete settings"
  ON organization_settings FOR DELETE
  USING (public.user_org_role(organization_id) = 'owner');

-- Trigger for updated_at
CREATE TRIGGER org_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3. MIGRATE DATA: user_settings → organization_settings
-- ============================================================

INSERT INTO organization_settings (
  organization_id, business_name, business_email, business_address,
  business_phone, logo_url, default_rate, invoice_prefix,
  invoice_next_num, tax_rate
)
SELECT
  us.organization_id, us.business_name, us.business_email,
  us.business_address, us.business_phone, us.logo_url,
  us.default_rate, us.invoice_prefix, us.invoice_next_num, us.tax_rate
FROM user_settings us
WHERE us.organization_id IS NOT NULL
ON CONFLICT (organization_id) DO NOTHING;

-- ============================================================
-- 4. SLIM DOWN user_settings (drop org-scoped columns)
-- Must drop the RLS policy first since it depends on organization_id
-- ============================================================

DROP POLICY IF EXISTS "Org members manage settings" ON user_settings;

ALTER TABLE user_settings DROP COLUMN IF EXISTS business_name;
ALTER TABLE user_settings DROP COLUMN IF EXISTS business_email;
ALTER TABLE user_settings DROP COLUMN IF EXISTS business_address;
ALTER TABLE user_settings DROP COLUMN IF EXISTS business_phone;
ALTER TABLE user_settings DROP COLUMN IF EXISTS logo_url;
ALTER TABLE user_settings DROP COLUMN IF EXISTS default_rate;
ALTER TABLE user_settings DROP COLUMN IF EXISTS invoice_prefix;
ALTER TABLE user_settings DROP COLUMN IF EXISTS invoice_next_num;
ALTER TABLE user_settings DROP COLUMN IF EXISTS tax_rate;
ALTER TABLE user_settings DROP COLUMN IF EXISTS organization_id;

-- RLS: user_settings is now purely user-scoped
CREATE POLICY "Users manage own settings"
  ON user_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 5. USER PROFILES
-- ============================================================

CREATE TABLE user_profiles (
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  display_name TEXT,
  avatar_url   TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view profiles (needed for member lists)
CREATE POLICY "Authenticated users can view profiles"
  ON user_profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Backfill profiles from auth.users
INSERT INTO user_profiles (user_id, display_name)
SELECT id, split_part(email, '@', 1)
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- 6. ALLOW AUTHENTICATED USERS TO CREATE ORGANIZATIONS
-- ============================================================

CREATE POLICY "Authenticated users can create organizations"
  ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- 7. UPDATE SIGNUP TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create personal organization
  INSERT INTO organizations (name, slug, is_personal)
  VALUES (
    split_part(NEW.email, '@', 1) || '''s Organization',
    'org-' || replace(NEW.id::text, '-', ''),
    true
  )
  RETURNING id INTO new_org_id;

  -- Make user the owner
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  -- Create organization settings with defaults
  INSERT INTO organization_settings (organization_id)
  VALUES (new_org_id);

  -- Create lean user settings (github token only)
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  -- Create user profile
  INSERT INTO user_profiles (user_id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
