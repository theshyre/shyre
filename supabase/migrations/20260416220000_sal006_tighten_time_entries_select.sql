-- SAL-006: tighten time_entries SELECT default to own-entries-only.
--
-- Problem: the current time_entries_select policy uses
-- `user_has_team_access(team_id)` in its middle clause, which means any
-- team member can SELECT any other team member's time entries — including
-- duration, billable flag, description, and any rate information joined
-- in via the project/customer. The write-side policies are already tight
-- (own-entry or owner/admin), but read-side has been loose since the
-- multi-tenant split in migration 002.
--
-- Fix: a member sees only their own entries by default. Owner/admin see
-- everything in their team. The cross-team share clause (a customer admin
-- in another team with `can_see_others_entries`) is preserved — it's an
-- explicit opt-in mechanism and remains load-bearing for the sharing
-- flow.
--
-- INSERT / UPDATE / DELETE policies are unchanged — they were already
-- tight per migration 009 and the rename-to-customers migration.
--
-- Phase 3 of the rate-and-access plan will add a `time_entries_visibility`
-- config on team_settings + projects (own_only | read_all | read_write_all)
-- that an owner can set to loosen this default per team or per project.
-- Until then, this tight default is the only available level for members.
--
-- App impact: any server component that queries time_entries without an
-- explicit user_id filter will now return only the caller's own entries
-- when the caller is a plain member. For owner/admin, behavior is
-- unchanged. The reports page, business dashboard, and time-entries list
-- UIs all work correctly under this — in fact they now match the
-- design intent ("members log their own time, nothing else").
--
-- See: docs/reference/rate-and-access-plan.md (Phase 1).

DROP POLICY IF EXISTS "time_entries_select" ON public.time_entries;

CREATE POLICY "time_entries_select" ON public.time_entries FOR SELECT
  USING (
    -- Own entry: always visible.
    user_id = auth.uid()
    -- Owner / admin in the entry's team: see everything.
    OR public.user_team_role(team_id) IN ('owner', 'admin')
    -- Cross-team share: admin of a shared customer can see entries on
    -- projects that belong to that customer. Preserves the existing
    -- customer-sharing workflow in migration 009 / 20260414203937.
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = time_entries.project_id
        AND p.customer_id IS NOT NULL
        AND public.user_can_see_cross_team_entries(p.customer_id)
    )
  );
