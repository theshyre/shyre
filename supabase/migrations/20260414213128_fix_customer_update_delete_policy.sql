-- Fix: the rename migration wrote customers_update/delete policies that
-- were more permissive than the originals:
--   - customers_update allowed contributors to update (original: admin only)
--   - customers_delete allowed any user_id = auth.uid() (original: org
--     owner/admin only)
-- Restore the original semantics.

DROP POLICY IF EXISTS "customers_update" ON public.customers;
CREATE POLICY "customers_update" ON public.customers FOR UPDATE
  USING (public.user_customer_permission(id) = 'admin')
  WITH CHECK (public.user_customer_permission(id) = 'admin');

DROP POLICY IF EXISTS "customers_delete" ON public.customers;
CREATE POLICY "customers_delete" ON public.customers FOR DELETE
  USING (public.user_org_role(organization_id) IN ('owner', 'admin'));
