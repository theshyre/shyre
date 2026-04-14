-- Fix handle_new_user trigger
-- The trigger was failing silently with "Database error creating new user"
-- because organization_members has RLS policies and SECURITY DEFINER alone
-- isn't enough if the function owner doesn't have the right privileges.
--
-- Fix: explicitly set search_path and ensure the function can bypass RLS
-- by running as a privileged role.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create personal organization
  INSERT INTO public.organizations (name, slug, is_personal)
  VALUES (
    split_part(NEW.email, '@', 1) || '''s Organization',
    'org-' || replace(NEW.id::text, '-', ''),
    true
  )
  RETURNING id INTO new_org_id;

  -- Make user the owner
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  -- Create organization settings with defaults
  INSERT INTO public.organization_settings (organization_id)
  VALUES (new_org_id);

  -- Create lean user settings (github token only)
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  -- Create user profile
  INSERT INTO public.user_profiles (user_id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1));

  RETURN NEW;
END;
$$;
