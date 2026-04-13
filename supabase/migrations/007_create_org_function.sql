-- Atomic organization creation via SECURITY DEFINER function
-- Solves the chicken-and-egg RLS problem: creating an org requires
-- inserting into organizations + organization_members + organization_settings,
-- but the member insert's RLS check requires being a member already.

CREATE OR REPLACE FUNCTION public.create_organization(org_name TEXT)
RETURNS UUID AS $$
DECLARE
  new_org_id UUID;
  new_slug TEXT;
  creator_id UUID;
BEGIN
  creator_id := auth.uid();

  IF creator_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF org_name IS NULL OR length(trim(org_name)) = 0 THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  -- Generate slug
  new_slug := lower(regexp_replace(trim(org_name), '[^a-z0-9]+', '-', 'gi'));
  new_slug := regexp_replace(new_slug, '(^-|-$)', '', 'g');
  new_slug := substring(new_slug, 1, 50) || '-' || extract(epoch from now())::text;

  -- Create org
  INSERT INTO organizations (name, slug, is_personal)
  VALUES (trim(org_name), new_slug, false)
  RETURNING id INTO new_org_id;

  -- Make creator the owner (bypasses RLS since SECURITY DEFINER)
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, creator_id, 'owner');

  -- Create default settings
  INSERT INTO organization_settings (organization_id)
  VALUES (new_org_id);

  RETURN new_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT) TO authenticated;
