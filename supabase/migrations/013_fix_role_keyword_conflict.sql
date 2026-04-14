-- Fix the `role` keyword conflict in SECURITY DEFINER functions.
-- `role` is a reserved SQL keyword referring to the current database role.
-- `SELECT role FROM table` was being parsed as the keyword, returning
-- the function's SECURITY DEFINER role ('postgres') instead of the column.
--
-- Fix: alias the table and qualify the column as `om.role` etc.

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
  caller_role TEXT;
  target_role TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT organization_id INTO current_primary FROM public.clients WHERE id = p_client_id;
  IF current_primary IS NULL THEN RAISE EXCEPTION 'Client not found'; END IF;

  SELECT om.role INTO caller_role FROM public.organization_members om
    WHERE om.organization_id = current_primary AND om.user_id = uid;
  IF caller_role IS NULL OR caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the current primary org owner can transfer';
  END IF;

  SELECT om.role INTO target_role FROM public.organization_members om
    WHERE om.organization_id = p_new_org_id AND om.user_id = uid;
  IF target_role IS NULL THEN
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

-- Also fix user_has_org_access, user_org_role, user_client_permission, etc.
-- Any function that queries organization_members.role needs the alias fix.

CREATE OR REPLACE FUNCTION public.user_org_role(org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT om.role INTO result FROM public.organization_members om
    WHERE om.organization_id = org_id AND om.user_id = auth.uid();
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_org_access(org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = org_id AND om.user_id = auth.uid()
  );
END;
$$;

-- user_client_permission uses role via a different local variable name but
-- also SELECTs from organization_members — let's rewrite it safely.
CREATE OR REPLACE FUNCTION public.user_client_permission(p_client_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  primary_org UUID;
  primary_role TEXT;
  best TEXT;
BEGIN
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT organization_id INTO primary_org FROM public.clients WHERE id = p_client_id;
  IF primary_org IS NULL THEN RETURN NULL; END IF;

  SELECT om.role INTO primary_role FROM public.organization_members om
    WHERE om.organization_id = primary_org AND om.user_id = uid;
  IF primary_role IN ('owner', 'admin') THEN RETURN 'admin'; END IF;
  IF primary_role = 'member' THEN best := 'contributor'; END IF;

  -- Check explicit admin grant
  IF EXISTS (
    SELECT 1 FROM public.client_permissions
    WHERE client_id = p_client_id AND principal_type = 'user'
      AND principal_id = uid AND permission_level = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM public.client_permissions cp
    JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
    WHERE cp.client_id = p_client_id AND cp.principal_type = 'group'
      AND sgm.user_id = uid AND cp.permission_level = 'admin'
  ) THEN RETURN 'admin'; END IF;

  IF best IS NULL AND EXISTS (
    SELECT 1 FROM public.client_shares cs
    JOIN public.organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.client_id = p_client_id AND om.user_id = uid
  ) THEN best := 'contributor'; END IF;

  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.client_permissions
      WHERE client_id = p_client_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'contributor'
    ) OR EXISTS (
      SELECT 1 FROM public.client_permissions cp
      JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.client_id = p_client_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'contributor'
    )
  ) THEN best := 'contributor'; END IF;

  IF best IS NULL AND EXISTS (
    SELECT 1 FROM public.organization_shares os
    JOIN public.organization_members om ON om.organization_id = os.child_org_id
    WHERE os.parent_org_id = primary_org
      AND os.accepted_at IS NOT NULL
      AND om.user_id = uid
  ) THEN best := 'viewer'; END IF;

  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.client_permissions
      WHERE client_id = p_client_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'viewer'
    ) OR EXISTS (
      SELECT 1 FROM public.client_permissions cp
      JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.client_id = p_client_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'viewer'
    )
  ) THEN best := 'viewer'; END IF;

  RETURN best;
END;
$$;

-- Drop the debug function
DROP FUNCTION IF EXISTS public.debug_change_primary(UUID, UUID);
