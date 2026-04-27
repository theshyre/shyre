-- Tighten business_people SELECT policy: HR data is owner/admin-only,
-- with a self-row exception so a linked user can still see their own
-- record.
--
-- The original `bp_select` policy (added in 20260420190000) used
-- `user_has_business_access(business_id)` — which returns true for
-- ANY team member of ANY team in the business. That meant a 6-person
-- shop with a junior contractor on a shared customer team could
-- SELECT every employee's `compensation_amount_cents`,
-- `compensation_schedule`, `address_line1`, and birth/employment
-- dates. Insert / update / delete were already correctly gated to
-- owner/admin; the SELECT policy was the outlier.
--
-- New policy:
--   - owner/admin of the business → see all rows for the business
--   - everyone else → see only their own row (`user_id = auth.uid()`)
--
-- The self-row exception preserves the case where a linked employee
-- views their own profile in `/business/[id]/people` — they still
-- see their own legal_name, employment_type, etc., just not their
-- coworkers'. Unlinked rows (no `user_id`) are owner/admin-only.
--
-- This is a *tightening* migration — no code today depends on the
-- broader read access (the only consumer is the people-section UI,
-- which is already inside `/business/[id]` where role-gating is
-- expected). Safe to ship code + migration together.

DROP POLICY IF EXISTS "bp_select" ON public.business_people;

CREATE POLICY "bp_select" ON public.business_people FOR SELECT
  USING (
    public.user_business_role(business_id) IN ('owner', 'admin')
    OR user_id = auth.uid()
  );
