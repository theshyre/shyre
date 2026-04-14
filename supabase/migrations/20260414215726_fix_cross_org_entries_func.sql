-- Fix: user_can_see_cross_org_entries was oversimplified in the rename
-- migration — only kept the "participating org member with config true"
-- branch. The original also returned TRUE for primary-org members and
-- for customer admins. Restore the full three-branch body, rewritten
-- with customer-named identifiers.

CREATE OR REPLACE FUNCTION public.user_can_see_cross_org_entries(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  primary_org UUID;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT organization_id INTO primary_org FROM public.customers WHERE id = p_client_id;
  IF primary_org IS NULL THEN RETURN false; END IF;

  -- Primary org members see all cross-org entries on this customer
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = uid AND organization_id = primary_org
  ) THEN RETURN true; END IF;

  -- Customer admins see all
  IF public.user_customer_permission(p_client_id) = 'admin' THEN
    RETURN true;
  END IF;

  -- Participating orgs see all if share config allows
  RETURN EXISTS (
    SELECT 1 FROM public.customer_shares cs
    JOIN public.organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.customer_id = p_client_id
      AND om.user_id = uid
      AND cs.can_see_others_entries = true
  );
END;
$$;
