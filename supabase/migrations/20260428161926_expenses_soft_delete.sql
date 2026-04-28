-- Expenses: soft-delete + restore.
--
-- Bookkeeper / agency-owner / UX persona findings all converged
-- on the same issue: `deleteExpenseAction` was a hard DELETE.
-- CLAUDE.md → "Destructive confirmation flows" item 3 mandates
-- soft-delete + Undo toast for any destructive action the user
-- could realistically want back. Expenses are *legally a tax
-- document* — losing them with no recovery path was the worst
-- offender of that rule.
--
-- Pattern mirrors `time_entries.deleted_at`:
--   - Add `deleted_at TIMESTAMPTZ`.
--   - List queries filter `WHERE deleted_at IS NULL`.
--   - Delete action UPDATEs `deleted_at = now()`.
--   - Restore action UPDATEs `deleted_at = NULL`.
--   - /trash surface lists soft-deleted rows for the team.
--   - Period-lock guard already keys off `incurred_on`; deletes
--     of locked-period rows are still blocked (we want that —
--     a locked tax row can't disappear, even softly).

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at
  ON public.expenses (team_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.expenses.deleted_at IS
  'Soft-delete timestamp. Rows with deleted_at IS NOT NULL are hidden from list views; restored via setting back to NULL within the Undo window or from /trash.';
