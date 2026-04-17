-- Phase 3: configurable time_entries visibility.
--
-- SAL-006 (migration 20260416231353) shipped a tight default: a team
-- member sees only their own time entries; owner/admin see all; cross-
-- team sharing preserved. That default covers the most common case
-- (log your time, nothing else) and is defensible for teams that have
-- never opted in.
--
-- Some teams legitimately want members to see team-wide hours (for
-- coordination) or even to edit each other's entries (for managers
-- doing retroactive timesheet cleanup). This migration adds two
-- config knobs so the owner can opt in:
--
--   team_settings.time_entries_visibility
--     'own_only' (default)  — member sees own only
--     'read_all'            — member reads all, writes own only
--     'read_write_all'      — member full CRUD on all team entries
--
--   projects.time_entries_visibility (nullable — NULL = inherit team)
--     same enum; lets a team go "own_only by default, but project X is
--     shared" without flipping the whole team.
--
-- Admin/owner always have full CRUD (above any level).
--
-- Helper: effective_time_entries_visibility(project_id, team_id)
-- returns the resolved level — project value wins over team value.
--
-- Policies updated: time_entries_select / _update / _delete all learn
-- the new cases. INSERT is unchanged — members always insert their own
-- entries; "insert on behalf" isn't part of read_write_all.

ALTER TABLE public.team_settings
  ADD COLUMN time_entries_visibility TEXT NOT NULL DEFAULT 'own_only'
    CHECK (time_entries_visibility IN ('own_only', 'read_all', 'read_write_all'));

ALTER TABLE public.projects
  ADD COLUMN time_entries_visibility TEXT
    CHECK (time_entries_visibility IS NULL
           OR time_entries_visibility IN ('own_only', 'read_all', 'read_write_all'));

CREATE OR REPLACE FUNCTION public.effective_time_entries_visibility(
  p_project_id UUID,
  p_team_id UUID
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT time_entries_visibility FROM projects WHERE id = p_project_id),
    (SELECT time_entries_visibility FROM team_settings WHERE team_id = p_team_id),
    'own_only'
  );
$$;

-- SELECT: add the read_all / read_write_all branch so configured teams
-- let their members read others' entries.
DROP POLICY IF EXISTS "time_entries_select" ON public.time_entries;

CREATE POLICY "time_entries_select" ON public.time_entries FOR SELECT
  USING (
    -- Own entry.
    user_id = auth.uid()

    -- Owner / admin in the entry's team.
    OR public.user_team_role(team_id) IN ('owner', 'admin')

    -- Visibility config opts members in to read others' entries.
    OR (
      public.user_team_role(team_id) = 'member'
      AND public.effective_time_entries_visibility(project_id, team_id)
          IN ('read_all', 'read_write_all')
    )

    -- Cross-team: owner/admin of the customer's primary team.
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.customers c ON c.id = p.customer_id
      WHERE p.id = time_entries.project_id
        AND public.user_team_role(c.team_id) IN ('owner', 'admin')
    )

    -- Cross-team: caller's team has a customer_share with can_see_others_entries.
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.customer_shares cs ON cs.customer_id = p.customer_id
      JOIN public.team_members tm ON tm.team_id = cs.team_id
      WHERE p.id = time_entries.project_id
        AND p.customer_id IS NOT NULL
        AND tm.user_id = auth.uid()
        AND cs.can_see_others_entries = true
    )

    -- Cross-team: caller has customer-admin permission on the customer.
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = time_entries.project_id
        AND p.customer_id IS NOT NULL
        AND public.user_customer_permission(p.customer_id) = 'admin'
    )
  );

-- UPDATE: add read_write_all branch so members can edit others' entries
-- on opted-in teams / projects.
DROP POLICY IF EXISTS "time_entries_update" ON public.time_entries;

CREATE POLICY "time_entries_update" ON public.time_entries FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.user_team_role(team_id) IN ('owner', 'admin')
    OR (
      public.user_team_role(team_id) = 'member'
      AND public.effective_time_entries_visibility(project_id, team_id)
          = 'read_write_all'
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = time_entries.project_id
        AND p.customer_id IS NOT NULL
        AND public.user_customer_permission(p.customer_id) = 'admin'
    )
  );

-- DELETE: same addition.
DROP POLICY IF EXISTS "time_entries_delete" ON public.time_entries;

CREATE POLICY "time_entries_delete" ON public.time_entries FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.user_team_role(team_id) IN ('owner', 'admin')
    OR (
      public.user_team_role(team_id) = 'member'
      AND public.effective_time_entries_visibility(project_id, team_id)
          = 'read_write_all'
    )
  );

-- INSERT is unchanged — members always insert only their own entries.
-- "Insert on behalf of another user" isn't part of read_write_all.
