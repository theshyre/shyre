-- Fix: user_customer_permission was oversimplified in the clients→customers
-- rename migration. Restore the full permission-resolution logic from the
-- original user_client_permission (migration 013), with every column /
-- table / function reference using the new customer-named identifiers.

CREATE OR REPLACE FUNCTION public.user_customer_permission(p_customer_id UUID)
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
  SELECT organization_id INTO primary_org FROM public.customers WHERE id = p_customer_id;
  IF primary_org IS NULL THEN RETURN NULL; END IF;

  -- Primary org: owner/admin → admin; member → contributor baseline
  SELECT om.role INTO primary_role FROM public.organization_members om
    WHERE om.organization_id = primary_org AND om.user_id = uid;
  IF primary_role IN ('owner', 'admin') THEN RETURN 'admin'; END IF;
  IF primary_role = 'member' THEN best := 'contributor'; END IF;

  -- Explicit admin grant (user or group)
  IF EXISTS (
    SELECT 1 FROM public.customer_permissions
    WHERE customer_id = p_customer_id AND principal_type = 'user'
      AND principal_id = uid AND permission_level = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_permissions cp
    JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
    WHERE cp.customer_id = p_customer_id AND cp.principal_type = 'group'
      AND sgm.user_id = uid AND cp.permission_level = 'admin'
  ) THEN RETURN 'admin'; END IF;

  -- Participating-org member via customer_shares → contributor baseline
  IF best IS NULL AND EXISTS (
    SELECT 1 FROM public.customer_shares cs
    JOIN public.organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.customer_id = p_customer_id AND om.user_id = uid
  ) THEN best := 'contributor'; END IF;

  -- Explicit contributor grant
  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.customer_permissions
      WHERE customer_id = p_customer_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'contributor'
    ) OR EXISTS (
      SELECT 1 FROM public.customer_permissions cp
      JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.customer_id = p_customer_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'contributor'
    )
  ) THEN best := 'contributor'; END IF;

  -- Child org via accepted organization_shares → viewer baseline
  IF best IS NULL AND EXISTS (
    SELECT 1 FROM public.organization_shares os
    JOIN public.organization_members om ON om.organization_id = os.child_org_id
    WHERE os.parent_org_id = primary_org
      AND os.accepted_at IS NOT NULL
      AND om.user_id = uid
  ) THEN best := 'viewer'; END IF;

  -- Explicit viewer grant
  IF best IS NULL AND (
    EXISTS (
      SELECT 1 FROM public.customer_permissions
      WHERE customer_id = p_customer_id AND principal_type = 'user'
        AND principal_id = uid AND permission_level = 'viewer'
    ) OR EXISTS (
      SELECT 1 FROM public.customer_permissions cp
      JOIN public.security_group_members sgm ON sgm.group_id = cp.principal_id
      WHERE cp.customer_id = p_customer_id AND cp.principal_type = 'group'
        AND sgm.user_id = uid AND cp.permission_level = 'viewer'
    )
  ) THEN best := 'viewer'; END IF;

  RETURN best;
END;
$$;
