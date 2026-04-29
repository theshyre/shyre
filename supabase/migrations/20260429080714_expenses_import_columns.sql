-- Expenses CSV import — schema bits required by /import/expenses.
--
-- Other importable tables (customers, projects, time_entries, invoices)
-- already carry these four import-trail columns. expenses didn't,
-- because Harvest's importer reaches them through projects+entries
-- rather than direct expense rows. The new CSV importer writes
-- expenses directly so the columns are now load-bearing.
--
-- Also adds a `notes` column for the CSV's "Comments" field — invoice
-- numbers, order numbers, multi-line receipt notes — which doesn't
-- belong in `description` (that's "what was bought") but is critical
-- audit data the user clearly cares about (the source spreadsheet has
-- carried it row-by-row for years).
--
-- Migration is additive (ADD COLUMN IF NOT EXISTS, partial unique
-- index). Safe to ship code + schema in the same PR per the
-- migrations playbook.

-- ============================================================
-- 1. Free-form notes column
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.expenses.notes IS
  'Audit-trail metadata that doesn''t fit description: invoice / order numbers, client / matter numbers, miscellaneous receipt comments.';

-- ============================================================
-- 2. Import-trail columns
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS imported_from TEXT;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS import_source_id TEXT;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS import_run_id UUID
    REFERENCES public.import_runs(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

-- Idempotency: same CSV uploaded twice (or the same row reuploaded as
-- part of a re-run) must not produce duplicates. Partial unique index
-- so non-imported rows aren't constrained at all. Scoped to team_id
-- so two teams can independently import a row with the same hash
-- (different businesses, separate ledgers).
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_import_source
  ON public.expenses (team_id, imported_from, import_source_id)
  WHERE import_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_import_run
  ON public.expenses (import_run_id)
  WHERE import_run_id IS NOT NULL;

-- ============================================================
-- 3. Allow csv-expenses on import_runs.imported_from
-- ============================================================
--
-- The CHECK constraint added in 20260423140000_import_runs.sql only
-- allowed 'harvest'. Widen it to include 'csv-expenses' so the new
-- importer can record runs in the same table — the existing import
-- history page + Undo button reuse this surface.

ALTER TABLE public.import_runs
  DROP CONSTRAINT IF EXISTS import_runs_imported_from_check;

ALTER TABLE public.import_runs
  ADD CONSTRAINT import_runs_imported_from_check
  CHECK (imported_from IN ('harvest', 'csv-expenses'));
