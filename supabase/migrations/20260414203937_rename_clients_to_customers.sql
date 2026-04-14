-- Rename clients → customers (platform unification)
--
-- "Clients" was the consulting-specific name for the entities this business
-- bills. Now that the app is becoming a broader Business Home platform
-- (Shyre), the entity is unified as "customers" — usable by time tracking,
-- invoicing, product sales, or any future module. One table, one concept.
--
-- This migration renames tables, columns, indexes, RLS policies, and
-- helper / RPC functions. No data changes — just identifiers.
--
-- Ordering: (1) rename physical schema objects, (2) create new functions,
-- (3) drop old policies, (4) create new policies, (5) drop old functions.

-- ============================================================
-- 1. Tables + FK columns + indexes
-- ============================================================

ALTER TABLE clients RENAME TO customers;
ALTER TABLE client_shares RENAME TO customer_shares;
ALTER TABLE client_permissions RENAME TO customer_permissions;

ALTER TABLE customer_shares RENAME COLUMN client_id TO customer_id;
ALTER TABLE customer_permissions RENAME COLUMN client_id TO customer_id;

ALTER TABLE projects RENAME COLUMN client_id TO customer_id;
ALTER TABLE invoices RENAME COLUMN client_id TO customer_id;

ALTER INDEX IF EXISTS idx_clients_user_id RENAME TO idx_customers_user_id;
ALTER INDEX IF EXISTS idx_clients_org_id RENAME TO idx_customers_org_id;
ALTER INDEX IF EXISTS idx_projects_client_id RENAME TO idx_projects_customer_id;
ALTER INDEX IF EXISTS idx_invoices_client_id RENAME TO idx_invoices_customer_id;
ALTER INDEX IF EXISTS idx_client_shares_client RENAME TO idx_customer_shares_customer;
ALTER INDEX IF EXISTS idx_client_shares_org RENAME TO idx_customer_shares_org;
ALTER INDEX IF EXISTS idx_client_perms_client RENAME TO idx_customer_perms_customer;
ALTER INDEX IF EXISTS idx_client_perms_user RENAME TO idx_customer_perms_user;
ALTER INDEX IF EXISTS idx_client_perms_group RENAME TO idx_customer_perms_group;

-- ============================================================
-- 2. Create new helper + RPC functions (old ones still exist here,
--    old policies still bound to them)
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_can_view_customer(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
  primary_org UUID;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  SELECT organization_id INTO primary_org FROM customers WHERE id = p_customer_id;
  IF primary_org IS NULL THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = uid AND organization_id = primary_org
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM customer_shares cs
    JOIN organization_members om ON om.organization_id = cs.organization_id
    WHERE cs.customer_id = p_customer_id AND om.user_id = uid
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM organization_shares os
    JOIN organization_members om ON om.organization_id = os.child_org_id
    WHERE os.parent_org_id = primary_org
      AND os.accepted_at IS NOT NULL
      AND om.user_id = uid
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM customer_permissions
    WHERE customer_id = p_customer_id
      AND principal_type = 'user'
      AND principal_id = uid
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM customer_permissions cp
    JOIN security_group_members sgm
      ON sgm.group_id = cp.principal_id AND cp.principal_type = 'group'
    WHERE cp.customer_id = p_customer_id AND sgm.user_id = uid
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_customer_permission(p_customer_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
  best TEXT;
  primary_org UUID;
BEGIN
  IF uid IS NULL THEN RETURN NULL; END IF;

  SELECT organization_id INTO primary_org FROM customers WHERE id = p_customer_id;
  IF primary_org IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = uid
      AND organization_id = primary_org
      AND role IN ('owner', 'admin')
  ) THEN RETURN 'admin'; END IF;

  SELECT permission_level INTO best
  FROM customer_permissions
  WHERE customer_id = p_customer_id
    AND principal_type = 'user'
    AND principal_id = uid
  LIMIT 1;
  IF best IS NOT NULL THEN RETURN best; END IF;

  SELECT cp.permission_level INTO best
  FROM customer_permissions cp
  JOIN security_group_members sgm
    ON sgm.group_id = cp.principal_id AND cp.principal_type = 'group'
  WHERE cp.customer_id = p_customer_id AND sgm.user_id = uid
  ORDER BY
    CASE cp.permission_level
      WHEN 'admin' THEN 3
      WHEN 'contributor' THEN 2
      WHEN 'viewer' THEN 1
      ELSE 0
    END DESC
  LIMIT 1;

  RETURN best;
END;
$$;

-- Keep the parameter name (p_client_id) unchanged — policies on time_entries
-- depend on this function signature, so we can only update the body.
CREATE OR REPLACE FUNCTION public.user_can_see_cross_org_entries(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  uid UUID := auth.uid();
  visible BOOLEAN := false;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  SELECT TRUE INTO visible
  FROM customer_shares cs
  JOIN organization_members om ON om.organization_id = cs.organization_id
  WHERE cs.customer_id = p_client_id
    AND om.user_id = uid
    AND cs.can_see_others_entries = true
  LIMIT 1;

  RETURN COALESCE(visible, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_customer_share(
  p_customer_id UUID,
  p_org_id UUID,
  p_can_see_others BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF public.user_customer_permission(p_customer_id) <> 'admin' THEN
    RAISE EXCEPTION 'only customer admins can add shares';
  END IF;

  INSERT INTO customer_shares (customer_id, organization_id, can_see_others_entries, created_by)
  VALUES (p_customer_id, p_org_id, p_can_see_others, auth.uid())
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_customer_permission(
  p_customer_id UUID,
  p_principal_type TEXT,
  p_principal_id UUID,
  p_level TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF public.user_customer_permission(p_customer_id) <> 'admin' THEN
    RAISE EXCEPTION 'only customer admins can grant permissions';
  END IF;

  INSERT INTO customer_permissions
    (customer_id, principal_type, principal_id, permission_level, granted_by)
  VALUES (p_customer_id, p_principal_type, p_principal_id, p_level, auth.uid())
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_customer_primary_org(
  p_customer_id UUID,
  p_new_org_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  r_role TEXT;
BEGIN
  IF public.user_customer_permission(p_customer_id) <> 'admin' THEN
    RAISE EXCEPTION 'only customer admins can change the primary org';
  END IF;

  SELECT role INTO r_role FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = p_new_org_id;
  IF r_role IS NULL THEN
    RAISE EXCEPTION 'you are not a member of the target organization';
  END IF;

  UPDATE customers SET organization_id = p_new_org_id WHERE id = p_customer_id;
END;
$$;

-- ============================================================
-- 3. Drop old policies (they reference old function names)
-- ============================================================

DROP POLICY IF EXISTS "Users manage own clients"      ON customers;
DROP POLICY IF EXISTS "Org members manage clients"    ON customers;
DROP POLICY IF EXISTS "Users can view own clients"    ON customers;
DROP POLICY IF EXISTS "Users can insert own clients"  ON customers;
DROP POLICY IF EXISTS "Users can update own clients"  ON customers;
DROP POLICY IF EXISTS "Users can delete own clients"  ON customers;
DROP POLICY IF EXISTS "clients_select"                ON customers;
DROP POLICY IF EXISTS "clients_insert"                ON customers;
DROP POLICY IF EXISTS "clients_update"                ON customers;
DROP POLICY IF EXISTS "clients_delete"                ON customers;

DROP POLICY IF EXISTS "client_shares_select" ON customer_shares;
DROP POLICY IF EXISTS "client_shares_manage" ON customer_shares;

DROP POLICY IF EXISTS "client_permissions_select" ON customer_permissions;
DROP POLICY IF EXISTS "client_permissions_manage" ON customer_permissions;

-- ============================================================
-- 4. Create new policies (using new function names)
-- ============================================================

CREATE POLICY "customers_select" ON customers FOR SELECT
  USING (public.user_can_view_customer(id));
CREATE POLICY "customers_insert" ON customers FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND user_has_org_access(organization_id)
  );
CREATE POLICY "customers_update" ON customers FOR UPDATE
  USING (
    public.user_customer_permission(id) IN ('admin', 'contributor')
    OR user_id = auth.uid()
  )
  WITH CHECK (
    public.user_customer_permission(id) IN ('admin', 'contributor')
    OR user_id = auth.uid()
  );
CREATE POLICY "customers_delete" ON customers FOR DELETE
  USING (
    public.user_customer_permission(id) = 'admin'
    OR user_id = auth.uid()
  );

CREATE POLICY "customer_shares_select" ON customer_shares FOR SELECT
  USING (public.user_can_view_customer(customer_id));
CREATE POLICY "customer_shares_manage" ON customer_shares FOR ALL
  USING (public.user_customer_permission(customer_id) = 'admin')
  WITH CHECK (public.user_customer_permission(customer_id) = 'admin');

CREATE POLICY "customer_permissions_select" ON customer_permissions FOR SELECT
  USING (public.user_can_view_customer(customer_id));
CREATE POLICY "customer_permissions_manage" ON customer_permissions FOR ALL
  USING (public.user_customer_permission(customer_id) = 'admin')
  WITH CHECK (public.user_customer_permission(customer_id) = 'admin');

-- ============================================================
-- 5. Rebuild projects + time_entries policies to use new function
--    names (they used to reference user_can_view_client etc., which
--    we're about to drop). Column refs (client_id → customer_id) are
--    auto-updated by Postgres when the column was renamed above.
-- ============================================================

DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;

CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  (customer_id IS NULL AND public.user_has_org_access(organization_id))
  OR (customer_id IS NOT NULL AND public.user_can_view_customer(customer_id))
);
CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (
  (customer_id IS NULL AND public.user_has_org_access(organization_id))
  OR (customer_id IS NOT NULL AND public.user_customer_permission(customer_id) = 'admin')
);
CREATE POLICY "projects_update" ON projects FOR UPDATE USING (
  (customer_id IS NULL AND public.user_org_role(organization_id) IN ('owner', 'admin'))
  OR (customer_id IS NOT NULL AND public.user_customer_permission(customer_id) = 'admin')
);
CREATE POLICY "projects_delete" ON projects FOR DELETE USING (
  (customer_id IS NULL AND public.user_org_role(organization_id) IN ('owner', 'admin'))
  OR (customer_id IS NOT NULL AND public.user_customer_permission(customer_id) = 'admin')
);

-- time_entries policies reference projects.customer_id (was client_id) +
-- user_can_see_cross_org_entries (kept signature, updated body earlier)

DROP POLICY IF EXISTS "time_entries_select" ON time_entries;
DROP POLICY IF EXISTS "time_entries_insert" ON time_entries;
DROP POLICY IF EXISTS "time_entries_update" ON time_entries;

CREATE POLICY "time_entries_select" ON time_entries FOR SELECT USING (
  user_id = auth.uid()
  OR public.user_has_org_access(organization_id)
  OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = time_entries.project_id
      AND p.customer_id IS NOT NULL
      AND public.user_can_see_cross_org_entries(p.customer_id)
  )
);

CREATE POLICY "time_entries_insert" ON time_entries FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND public.user_has_org_access(organization_id)
  AND (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.customer_id IS NULL
        AND p.organization_id = time_entries.organization_id
    )
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id
        AND p.customer_id IS NOT NULL
        AND public.user_customer_permission(p.customer_id) IN ('contributor', 'admin')
    )
  )
);

CREATE POLICY "time_entries_update" ON time_entries FOR UPDATE USING (
  user_id = auth.uid()
  OR public.user_org_role(organization_id) IN ('owner', 'admin')
  OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = time_entries.project_id
      AND p.customer_id IS NOT NULL
      AND public.user_customer_permission(p.customer_id) = 'admin'
  )
);

-- Invoices policies that reference user_client_permission
DROP POLICY IF EXISTS "invoices_select" ON invoices;

CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (
  public.user_has_org_access(organization_id)
  OR (customer_id IS NOT NULL AND public.user_customer_permission(customer_id) = 'admin')
);

-- ============================================================
-- 6. Drop old-named functions (policies no longer reference them)
-- ============================================================

DROP FUNCTION IF EXISTS public.user_can_view_client(UUID);
DROP FUNCTION IF EXISTS public.user_client_permission(UUID);
DROP FUNCTION IF EXISTS public.add_client_share(UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.grant_client_permission(UUID, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.change_client_primary_org(UUID, UUID);
