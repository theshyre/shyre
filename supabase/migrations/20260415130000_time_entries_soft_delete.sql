-- Time entries: soft delete
--
-- Adds `deleted_at timestamptz null` to support the Trash flow:
--   - row-level delete from the timesheet sets deleted_at = now()
--   - entries with deleted_at IS NOT NULL are excluded from normal listings
--     by explicit query filter (NOT by an RLS predicate — we still want the
--     owner to read/update/restore their trashed rows)
--   - /time-entries/trash lists deleted_at IS NOT NULL rows
--
-- RLS is unchanged: auth.uid() = user_id FOR ALL. Owner can read, restore
-- (UPDATE set deleted_at = NULL), or permanently delete their trashed rows.
-- Every non-trash query must add `.is('deleted_at', null)` — there is no
-- view wrapping this, intentionally, so the filter is visible at call sites.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index so normal listings (the overwhelming majority) stay fast
-- without paying for the index on trashed rows.
CREATE INDEX IF NOT EXISTS idx_time_entries_active_start_time
  ON time_entries (user_id, start_time)
  WHERE deleted_at IS NULL;

-- Smaller index for the trash view
CREATE INDEX IF NOT EXISTS idx_time_entries_deleted_at
  ON time_entries (user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
