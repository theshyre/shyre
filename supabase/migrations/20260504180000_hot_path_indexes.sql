-- Hot-path read indexes for dashboard / time-entries / running-timer queries.
--
-- Audit ran 2026-05-04 alongside the prelude-parallelization work. The
-- request-prelude tables (user_profiles, team_members, system_admins,
-- user_settings, team_period_locks, error_logs) all already have
-- indexes that cover their predicates. The remaining hits all live on
-- time_entries and projects:
--
--   1. Running-timer probe — `WHERE end_time IS NULL AND deleted_at
--      IS NULL`. Fires on every /time-entries page load and on
--      RunningTimerHeaderPill. Currently a partial heap scan since
--      the existing partial indexes don't filter on end_time IS NULL.
--      Tiny resulting index (≤ 1 row per user) → very fast probe.
--
--   2. Unbilled-hours card — `WHERE deleted_at IS NULL AND
--      end_time IS NOT NULL AND billable = true AND invoiced = false`.
--      Fires on every /dashboard load. Predicate is selective once
--      the time_entries table grows past a few thousand rows; ahead
--      of the 6-year Harvest backfill (~50-100k rows) we want this
--      indexed.
--
--   3. Active-projects list — `WHERE status = 'active' AND team_id
--      IN (...) ORDER BY name`. Fires on /dashboard, /time-entries,
--      /projects, every project picker. Covering both the filter and
--      the sort with one composite avoids the sort node.
--
-- All three are additive partial indexes with IF NOT EXISTS, ship-safe
-- in a single PR per docs/reference/migrations.md.

CREATE INDEX IF NOT EXISTS idx_time_entries_running
  ON time_entries (team_id, user_id)
  WHERE end_time IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_unbilled
  ON time_entries (team_id, start_time DESC)
  WHERE deleted_at IS NULL
    AND end_time IS NOT NULL
    AND billable = true
    AND invoiced = false;

CREATE INDEX IF NOT EXISTS idx_projects_team_active_name
  ON projects (team_id, name)
  WHERE status = 'active';
