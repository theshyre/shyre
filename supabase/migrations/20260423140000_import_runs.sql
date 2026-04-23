-- Import runs — a first-class record of each bulk-import operation.
--
-- Today's model stamps `import_run_id` on every imported row, which
-- is great for dedupe and undo-by-run-id, but there's no parent row
-- to hang run metadata off of (who triggered it, when, summary counts,
-- completion status, whether it's been undone). We derive all of that
-- by grouping across 5 tables right now, which is both expensive and
-- can't represent runs that failed partway through or were rolled back.
--
-- One row per run. The id here matches `import_run_id` on child rows,
-- so cleanup-by-run is one query per child table plus one update here.

CREATE TABLE public.import_runs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  triggered_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_from              TEXT NOT NULL CHECK (imported_from IN ('harvest')),
  source_account_identifier  TEXT,
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at               TIMESTAMPTZ,
  status                     TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                               'running', 'completed', 'failed'
                             )),
  summary                    JSONB,
  undone_at                  TIMESTAMPTZ,
  undone_by_user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_import_runs_team_started
  ON public.import_runs (team_id, started_at DESC);

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_runs_select" ON public.import_runs FOR SELECT
  USING (public.user_has_team_access(team_id));

CREATE POLICY "import_runs_insert" ON public.import_runs FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "import_runs_update" ON public.import_runs FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "import_runs_delete" ON public.import_runs FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- ============================================================
-- Backfill
-- ============================================================
--
-- If any imports already ran before this migration (they shouldn't
-- have — but defense in depth), reconstruct an import_runs row per
-- unique import_run_id across the 5 tables carrying it. The
-- reconstructed row has best-effort metadata: imported_from is
-- recovered from the child row, started_at from the min imported_at,
-- status is 'completed', summary counts are computed from the
-- current state of the child rows.

INSERT INTO public.import_runs (
  id, team_id, imported_from, started_at, completed_at, status, summary
)
SELECT
  run_id                               AS id,
  team_id,
  imported_from,
  MIN(imported_at)                     AS started_at,
  MAX(imported_at)                     AS completed_at,
  'completed'                          AS status,
  jsonb_build_object(
    'customers',   SUM(customers_ct),
    'projects',    SUM(projects_ct),
    'time_entries', SUM(time_entries_ct)
  )                                    AS summary
FROM (
  SELECT
    import_run_id AS run_id,
    team_id,
    imported_from,
    imported_at,
    COUNT(*) FILTER (WHERE src = 'customers')    AS customers_ct,
    COUNT(*) FILTER (WHERE src = 'projects')     AS projects_ct,
    COUNT(*) FILTER (WHERE src = 'time_entries') AS time_entries_ct
  FROM (
    SELECT import_run_id, team_id, imported_from, imported_at,
           'customers'    AS src FROM public.customers
           WHERE import_run_id IS NOT NULL
    UNION ALL
    SELECT import_run_id, team_id, imported_from, imported_at,
           'projects'     AS src FROM public.projects
           WHERE import_run_id IS NOT NULL
    UNION ALL
    SELECT import_run_id, team_id, imported_from, imported_at,
           'time_entries' AS src FROM public.time_entries
           WHERE import_run_id IS NOT NULL
  ) sub
  GROUP BY import_run_id, team_id, imported_from, imported_at
) grouped
GROUP BY run_id, team_id, imported_from
ON CONFLICT (id) DO NOTHING;
