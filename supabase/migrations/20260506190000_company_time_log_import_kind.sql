-- Widen the imported_from CHECK on import_runs and time_entries to
-- accept 'csv-company-time-log' alongside the existing 'harvest' /
-- 'csv-expenses'. Same shape as the expenses-CSV widening
-- (20260429080714_expenses_import_columns.sql).
--
-- Why: the seed-company-time-log script today marks its inserted
-- rows with a `[seed:company-time-log]` prefix in description text
-- as a sentinel for delete-and-replace idempotency. That prefix is
-- a developer-tool artifact that ended up visible to the user on
-- /time-entries (Image #11/#12 of the 2026-05-06 bug report).
-- Replacing the description sentinel with the existing
-- import_run_id infrastructure cleans the descriptions, lets the
-- seed run show up in /import history (where the user can Undo
-- it), and reuses audit machinery the team has already paid for.
--
-- Strictly additive — every existing row already validates against
-- the new CHECK (the previous values are still allowed).

ALTER TABLE public.import_runs
  DROP CONSTRAINT IF EXISTS import_runs_imported_from_check;
ALTER TABLE public.import_runs
  ADD CONSTRAINT import_runs_imported_from_check CHECK (
    imported_from IN ('harvest', 'csv-expenses', 'csv-company-time-log')
  );

ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_imported_from_check;
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_imported_from_check CHECK (
    imported_from IS NULL
    OR imported_from IN ('harvest', 'csv-expenses', 'csv-company-time-log')
  );
