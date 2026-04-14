-- Fix SECURITY DEFINER functions by setting explicit search_path.
-- Without this, they may not resolve auth.uid() or table references correctly
-- depending on the function owner's default search_path.

CREATE OR REPLACE FUNCTION public.change_client_primary_org(
  p_client_id UUID,
  p_new_org_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  current_primary UUID;
  current_role TEXT;
  new_role TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT organization_id INTO current_primary FROM public.clients WHERE id = p_client_id;
  IF current_primary IS NULL THEN RAISE EXCEPTION 'Client not found'; END IF;

  SELECT role INTO current_role FROM public.organization_members
    WHERE organization_id = current_primary AND user_id = uid;
  IF current_role IS NULL OR current_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the current primary org owner can transfer';
  END IF;

  SELECT role INTO new_role FROM public.organization_members
    WHERE organization_id = p_new_org_id AND user_id = uid;
  IF new_role IS NULL THEN
    RAISE EXCEPTION 'You must be a member of the target organization';
  END IF;

  DELETE FROM public.client_shares
    WHERE client_id = p_client_id AND organization_id = p_new_org_id;

  UPDATE public.clients SET organization_id = p_new_org_id WHERE id = p_client_id;
  UPDATE public.projects SET organization_id = p_new_org_id WHERE client_id = p_client_id;

  INSERT INTO public.client_shares (client_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_client_id, current_primary, true, uid)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_client_share(
  p_client_id UUID,
  p_org_id UUID,
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

  IF public.user_client_permission(p_client_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only client admins can add shares';
  END IF;

  IF EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Cannot share with the primary organization';
  END IF;

  INSERT INTO public.client_shares (client_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_client_id, p_org_id, p_can_see_others, uid)
  RETURNING id INTO new_share_id;

  RETURN new_share_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_client_permission(
  p_client_id UUID,
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

  IF public.user_client_permission(p_client_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only client admins can grant permissions';
  END IF;

  IF p_principal_type NOT IN ('user', 'group') THEN
    RAISE EXCEPTION 'principal_type must be user or group';
  END IF;

  IF p_level NOT IN ('viewer', 'contributor', 'admin') THEN
    RAISE EXCEPTION 'level must be viewer, contributor, or admin';
  END IF;

  INSERT INTO public.client_permissions (client_id, principal_type, principal_id, permission_level, granted_by)
  VALUES (p_client_id, p_principal_type, p_principal_id, p_level, uid)
  ON CONFLICT (client_id, principal_type, principal_id)
    DO UPDATE SET permission_level = EXCLUDED.permission_level, granted_by = uid, granted_at = now()
  RETURNING id INTO new_perm_id;

  RETURN new_perm_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.propose_organization_share(
  p_parent_org_id UUID,
  p_child_org_id UUID,
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

  IF public.user_org_role(p_parent_org_id) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners/admins can propose org shares from parent';
  END IF;

  INSERT INTO public.organization_shares (parent_org_id, child_org_id, sharing_level, proposed_by)
  VALUES (p_parent_org_id, p_child_org_id, p_sharing_level, uid)
  RETURNING id INTO new_share_id;

  RETURN new_share_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_organization_share(
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

  SELECT * INTO share_record FROM public.organization_shares WHERE id = p_share_id;
  IF share_record IS NULL THEN RAISE EXCEPTION 'Share proposal not found'; END IF;
  IF share_record.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Already accepted'; END IF;

  IF public.user_org_role(share_record.child_org_id) NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only child org owners/admins can accept';
  END IF;

  UPDATE public.organization_shares SET accepted_at = now() WHERE id = p_share_id;
END;
$$;

-- Also fix create_organization from migration 007
CREATE OR REPLACE FUNCTION public.create_organization(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  new_slug := lower(regexp_replace(trim(org_name), '[^a-z0-9]+', '-', 'gi'));
  new_slug := regexp_replace(new_slug, '(^-|-$)', '', 'g');
  new_slug := substring(new_slug, 1, 50) || '-' || extract(epoch from now())::text;

  INSERT INTO public.organizations (name, slug, is_personal)
  VALUES (trim(org_name), new_slug, false)
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, creator_id, 'owner');

  INSERT INTO public.organization_settings (organization_id)
  VALUES (new_org_id);

  RETURN new_org_id;
END;
$$;
