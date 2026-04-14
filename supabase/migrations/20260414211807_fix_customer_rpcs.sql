-- Fix: the customer-named RPCs (add_customer_share, grant_customer_permission,
-- change_customer_primary_org) created in the rename migration were
-- oversimplified and dropped logic from the originals (ON CONFLICT upsert,
-- primary-org guard, projects.organization_id sync on transfer, etc.).
-- Restore the full bodies from migration 011/013, rewritten with the new
-- table/column/function names.

CREATE OR REPLACE FUNCTION public.change_customer_primary_org(
  p_customer_id UUID,
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

  SELECT organization_id INTO current_primary
    FROM public.customers WHERE id = p_customer_id;
  IF current_primary IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

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

  -- Clear any existing share to the new primary (would be redundant)
  DELETE FROM public.customer_shares
    WHERE customer_id = p_customer_id AND organization_id = p_new_org_id;

  -- Move the customer and its projects
  UPDATE public.customers SET organization_id = p_new_org_id WHERE id = p_customer_id;
  UPDATE public.projects SET organization_id = p_new_org_id WHERE customer_id = p_customer_id;

  -- Add the previous primary as a participating org so they retain access
  INSERT INTO public.customer_shares (customer_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_customer_id, current_primary, true, uid)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_customer_share(
  p_customer_id UUID,
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

  IF public.user_customer_permission(p_customer_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only customer admins can add shares';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Cannot share with the primary organization';
  END IF;

  INSERT INTO public.customer_shares
    (customer_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_customer_id, p_org_id, p_can_see_others, uid)
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
