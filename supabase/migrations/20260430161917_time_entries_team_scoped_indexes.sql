-- time_entries: team-scoped composite indexes for range queries
--
-- Phase 1 of the Unified Time view rollout (see
-- docs/reference/unified-time.md §Indexes). Independent of whether
-- the Log ever ships — the existing /time-entries day/week views
-- already issue `WHERE team_id = ? AND start_time >= ? AND
-- start_time < ? AND deleted_at IS NULL` and rely on a bitmap-heap
-- merge over single-column indexes. That plan is fine at today's
-- row counts but degrades on multi-year scans (5y x ~5/day = ~9k
-- rows).
--
-- Two composite partial indexes, both restricted to non-trashed
-- rows (the overwhelming majority of reads), ordered by start_time
-- DESC so the cursor pagination on (start_time DESC, id DESC) is
-- index-only:
--
--   1. (team_id, start_time DESC) — backs the team-scoped range
--      query (members=me resolves to user_id filter on top of this,
--      so this index alone is the working set for most queries).
--   2. (team_id, user_id, start_time DESC) — backs the swim-lane
--      query (members=all or member list filtered to a date range,
--      arriving in the Log when multi-author scope ships).
--
-- Both additive and IF NOT EXISTS per docs/reference/migrations.md.
-- Safe to ship code + migration in one PR.

CREATE INDEX IF NOT EXISTS idx_time_entries_team_active_start
  ON time_entries (team_id, start_time DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_team_user_active_start
  ON time_entries (team_id, user_id, start_time DESC)
  WHERE deleted_at IS NULL;
