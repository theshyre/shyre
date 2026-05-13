-- Persistent timesheet rows: per-user pins + team-wide defaults.
--
-- Background: a "row" in the Week / Day view today is implicit —
-- derived from the entries that exist on the visible week. That
-- means a (project, category) combo disappears the moment its
-- entries fall outside the visible week, and a new week starts
-- empty. The persona-converged design (2026-05-13) adds two
-- explicit primitives:
--
--   - time_pinned_rows: per-user pins, "this row earned a permanent
--     seat regardless of recent activity."
--   - time_team_default_rows: team-wide defaults, "every member sees
--     this row by default at first load (and onward)."
--
-- The Week view's row set becomes the union of:
--   (entries-this-week ∪ pinned ∪ team_default ∪ recent-N-day-entries)
-- — computed by stint_active_rows() in a sibling migration (or
-- here, see the function below).
--
-- Schema choices:
--   - category_id NULL is allowed = "any category for this project."
--     Mirrors the time_templates convention. Partial unique indexes
--     dedupe both the with-category and no-category cases.
--   - ON DELETE behavior on category: SET NULL. A category being
--     removed shouldn't silently drop a pin; degrade to a "no
--     category" pin that the user can re-tag. Matches time_entries.
--   - ON DELETE on project + team: CASCADE. A pin to a deleted
--     project is dead data.
--   - time_team_default_rows.created_by_user_id is nullable + SET
--     NULL on auth.users delete so a team default outlives the
--     admin who set it.

CREATE TABLE IF NOT EXISTS public.time_pinned_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category_id uuid NULL REFERENCES public.categories(id) ON DELETE SET NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes — Postgres treats NULL as distinct in
-- plain UNIQUE constraints, so we need two indexes to cover the
-- with-category and no-category cases independently.
CREATE UNIQUE INDEX IF NOT EXISTS time_pinned_rows_with_category_uq
  ON public.time_pinned_rows (team_id, user_id, project_id, category_id)
  WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS time_pinned_rows_no_category_uq
  ON public.time_pinned_rows (team_id, user_id, project_id)
  WHERE category_id IS NULL;

CREATE INDEX IF NOT EXISTS time_pinned_rows_team_user_idx
  ON public.time_pinned_rows (team_id, user_id);

ALTER TABLE public.time_pinned_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_pinned_rows_select" ON public.time_pinned_rows;
CREATE POLICY "time_pinned_rows_select" ON public.time_pinned_rows
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "time_pinned_rows_insert" ON public.time_pinned_rows;
CREATE POLICY "time_pinned_rows_insert" ON public.time_pinned_rows
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND public.user_team_role(team_id) IS NOT NULL
  );

DROP POLICY IF EXISTS "time_pinned_rows_delete" ON public.time_pinned_rows;
CREATE POLICY "time_pinned_rows_delete" ON public.time_pinned_rows
  FOR DELETE USING (user_id = auth.uid());

-- Team defaults — agency project lead / owner / admin sets rows
-- that every member sees by default. Member-level read-only.

CREATE TABLE IF NOT EXISTS public.time_team_default_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category_id uuid NULL REFERENCES public.categories(id) ON DELETE SET NULL,
  created_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS time_team_default_rows_with_cat_uq
  ON public.time_team_default_rows (team_id, project_id, category_id)
  WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS time_team_default_rows_no_cat_uq
  ON public.time_team_default_rows (team_id, project_id)
  WHERE category_id IS NULL;

CREATE INDEX IF NOT EXISTS time_team_default_rows_team_idx
  ON public.time_team_default_rows (team_id);

ALTER TABLE public.time_team_default_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_team_default_rows_select" ON public.time_team_default_rows;
CREATE POLICY "time_team_default_rows_select" ON public.time_team_default_rows
  FOR SELECT USING (public.user_team_role(team_id) IS NOT NULL);

DROP POLICY IF EXISTS "time_team_default_rows_insert" ON public.time_team_default_rows;
CREATE POLICY "time_team_default_rows_insert" ON public.time_team_default_rows
  FOR INSERT WITH CHECK (
    public.user_team_role(team_id) IN ('owner', 'admin')
    AND created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "time_team_default_rows_delete" ON public.time_team_default_rows;
CREATE POLICY "time_team_default_rows_delete" ON public.time_team_default_rows
  FOR DELETE USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- stint_active_rows: union of recent entries, pinned rows, and
-- team-default rows for a (team, user). Returns one row per
-- (project_id, category_id) tuple with a comma-joined `source`
-- discriminator and the freshest activity timestamp.
--
-- SECURITY INVOKER so RLS on projects + time_entries still applies
-- — a stale pin pointing to a project the user lost access to (or
-- a project that's been archived) drops out via the projects.id
-- EXISTS filter at the end.

CREATE OR REPLACE FUNCTION public.stint_active_rows(
  p_team_id uuid,
  p_user_id uuid,
  p_since timestamptz
)
RETURNS TABLE (
  project_id uuid,
  category_id uuid,
  source text,
  last_activity_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH recent AS (
    SELECT te.project_id, te.category_id,
           max(te.start_time) AS last_activity_at
    FROM public.time_entries te
    WHERE te.team_id = p_team_id
      AND te.user_id = p_user_id
      AND te.deleted_at IS NULL
      AND te.start_time >= p_since
    GROUP BY te.project_id, te.category_id
  ),
  pinned AS (
    SELECT tpr.project_id, tpr.category_id,
           tpr.pinned_at AS last_activity_at
    FROM public.time_pinned_rows tpr
    WHERE tpr.team_id = p_team_id AND tpr.user_id = p_user_id
  ),
  team_default AS (
    SELECT ttdr.project_id, ttdr.category_id,
           ttdr.created_at AS last_activity_at
    FROM public.time_team_default_rows ttdr
    WHERE ttdr.team_id = p_team_id
  ),
  unioned AS (
    SELECT project_id, category_id, 'recent'::text AS source, last_activity_at FROM recent
    UNION ALL
    SELECT project_id, category_id, 'pinned'::text AS source, last_activity_at FROM pinned
    UNION ALL
    SELECT project_id, category_id, 'team_default'::text AS source, last_activity_at FROM team_default
  )
  SELECT
    u.project_id,
    u.category_id,
    string_agg(DISTINCT u.source, ',' ORDER BY u.source) AS source,
    max(u.last_activity_at) AS last_activity_at
  FROM unioned u
  WHERE EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = u.project_id
      AND p.team_id = p_team_id
      AND (p.status IS NULL OR p.status <> 'archived')
  )
  GROUP BY u.project_id, u.category_id;
$$;

GRANT EXECUTE ON FUNCTION public.stint_active_rows(uuid, uuid, timestamptz) TO authenticated;
