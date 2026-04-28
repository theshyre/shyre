-- SAL-013 — Tighten expenses SELECT to author OR owner/admin.
--
-- Same shape as SAL-010 (business_people) and SAL-011 (invoices).
-- The original `expenses_select` policy from 014_expenses.sql said
--
--   USING (public.user_has_team_access(team_id))
--
-- which means every team member could SELECT every other team
-- member's expenses — vendor + amount + description + project +
-- billable flag. A junior contributor in a 6-person agency could
-- read the partner's client-dinner spend, the agency owner's
-- contractor payouts, and any other personal-feeling expense logged
-- through Shyre.
--
-- The user's mental model: "members can log their own expenses;
-- only owner/admin should see everyone's." The current write
-- policies already match that — INSERT requires `user_id = auth.uid()`,
-- UPDATE/DELETE require author OR owner/admin. SELECT is the
-- outlier.
--
-- New SELECT: author OR owner/admin of the team.

DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
CREATE POLICY "expenses_select" ON public.expenses FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.user_team_role(team_id) IN ('owner', 'admin')
  );
