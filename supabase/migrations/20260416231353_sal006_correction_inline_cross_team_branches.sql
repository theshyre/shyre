-- SAL-006 correction: the tight default shipped in migration
-- 20260416220000 accidentally remained loose for same-team members
-- because its third clause delegated to `user_can_see_cross_team_entries`,
-- whose FIRST branch returns TRUE for any member of the customer's
-- primary team. That branch was load-bearing for a different rule
-- (primary-team members seeing cross-team entries on their customers)
-- but silently re-opened the same-team read gate that the tightened
-- middle clause was trying to close.
--
-- Integration test `Carol (member of primaryTeam) cannot SELECT Alice's
-- (owner) entry in the same team` caught this (expected 0, got 1).
--
-- Rewrite the policy with the three cross-team branches inlined so
-- their individual conditions are visible and narrowable. A same-team
-- member now only reaches the select gate via own-entry (clause 1) or
-- their team role (clause 2). Cross-team visibility comes through three
-- explicit branches:
--
--   3. Owner/admin of the customer's primary team — so Alice (primary
--      team owner) still sees Dave's cross-team entry on her customer.
--      This was the "primary-org-member" branch of the delegated
--      helper, now narrowed to owner/admin.
--   4. Member of a team that has a customer_share with
--      can_see_others_entries = true on the entry's project's customer.
--      Preserves Dave (participating team member) being able to see
--      Alice's entry once Alice flips the flag true.
--   5. Customer-admin permission on the entry's project's customer.
--      Preserves external customer admins granted via
--      customer_permissions.
--
-- The INSERT / UPDATE / DELETE policies on time_entries are untouched —
-- they were already tight per migrations 009 / 20260414203937.

DROP POLICY IF EXISTS "time_entries_select" ON public.time_entries;

CREATE POLICY "time_entries_select" ON public.time_entries FOR SELECT
  USING (
    -- 1. Own entry: always visible.
    user_id = auth.uid()

    -- 2. Owner / admin in the entry's team: see everything.
    OR public.user_team_role(team_id) IN ('owner', 'admin')

    -- 3. Cross-team: owner/admin of the customer's primary team sees
    --    all entries on that customer's projects, regardless of which
    --    team's members logged them.
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE p.id = time_entries.project_id
        AND public.user_team_role(c.team_id) IN ('owner', 'admin')
    )

    -- 4. Cross-team: caller is in a team that has a customer_share on
    --    the project's customer with can_see_others_entries = true.
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.customer_shares cs ON cs.customer_id = p.customer_id
      JOIN public.team_members tm ON tm.team_id = cs.team_id
      WHERE p.id = time_entries.project_id
        AND p.customer_id IS NOT NULL
        AND tm.user_id = auth.uid()
        AND cs.can_see_others_entries = true
    )

    -- 5. Cross-team: caller has customer-admin permission on the
    --    project's customer.
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = time_entries.project_id
        AND p.customer_id IS NOT NULL
        AND public.user_customer_permission(p.customer_id) = 'admin'
    )
  );
