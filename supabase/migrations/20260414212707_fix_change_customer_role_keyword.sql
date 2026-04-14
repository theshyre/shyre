-- Fix: change_customer_primary_org used `current_role` as a local variable
-- name, which conflicts with PostgreSQL's CURRENT_ROLE keyword — the SELECT
-- resolves to the DB session role instead of the row's role column,
-- producing bogus NULL / owner-mismatch errors. Rename the local variables
-- and alias the column reference explicitly (same fix migration 013
-- applied to user_client_permission).

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
  primary_role TEXT;
  target_role TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT organization_id INTO current_primary
    FROM public.customers WHERE id = p_customer_id;
  IF current_primary IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT om.role INTO primary_role FROM public.organization_members om
    WHERE om.organization_id = current_primary AND om.user_id = uid;
  IF primary_role IS NULL OR primary_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the current primary org owner can transfer';
  END IF;

  SELECT om.role INTO target_role FROM public.organization_members om
    WHERE om.organization_id = p_new_org_id AND om.user_id = uid;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'You must be a member of the target organization';
  END IF;

  DELETE FROM public.customer_shares
    WHERE customer_id = p_customer_id AND organization_id = p_new_org_id;

  UPDATE public.customers SET organization_id = p_new_org_id WHERE id = p_customer_id;
  UPDATE public.projects SET organization_id = p_new_org_id WHERE customer_id = p_customer_id;

  INSERT INTO public.customer_shares (customer_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_customer_id, current_primary, true, uid)
  ON CONFLICT DO NOTHING;
END;
$$;
