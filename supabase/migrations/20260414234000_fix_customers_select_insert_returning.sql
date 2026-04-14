-- customers_select USING was `public.user_can_view_customer(id)`, which
-- internally re-queries `customers` to look up the row's organization_id:
--
--   SELECT organization_id INTO primary_org FROM customers WHERE id = p_customer_id;
--
-- For `INSERT ... RETURNING` (used by Supabase's `.insert().select()`), the
-- SELECT policy's USING expression is applied to the NEW row. Postgres's
-- same-statement visibility rules mean the newly-inserted row is NOT visible
-- to that nested SELECT, so `primary_org` comes back NULL, the function
-- returns false, and the whole INSERT fails with "new row violates row-level
-- security policy for table customers" — even for the row's legitimate owner.
--
-- This blocked `loadSampleDataAction` and (latently) any server action that
-- does `supabase.from("customers").insert(...).select(...)`. The existing
-- NewCustomerForm flow avoided it by not calling `.select()` after insert.
--
-- Fix: add a fast-path branch using the NEW row's own `organization_id`
-- (no customers re-query needed). Semantics unchanged — direct-org-member
-- access was already the first branch inside user_can_view_customer; we're
-- just lifting it out so RETURNING can see it.

DROP POLICY IF EXISTS "customers_select" ON public.customers;

CREATE POLICY "customers_select" ON public.customers FOR SELECT
  USING (
    -- Fast path: member of the customer's primary org. Uses the row's own
    -- organization_id directly — safe to evaluate during INSERT RETURNING.
    public.user_has_org_access(organization_id)
    -- Slow path: customer_shares, org_shares, per-user permissions,
    -- per-group permissions. Exercises the existing helper.
    OR public.user_can_view_customer(id)
  );
