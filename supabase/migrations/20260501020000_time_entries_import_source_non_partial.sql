-- Convert time_entries_import_source_unique to a non-partial unique
-- index so ON CONFLICT can reference it.
--
-- The original migration (20260423120000_import_audit_trail.sql)
-- created this as a PARTIAL index:
--
--   CREATE UNIQUE INDEX time_entries_import_source_unique
--     ON time_entries (team_id, imported_from, import_source_id)
--     WHERE import_source_id IS NOT NULL;
--
-- That works fine for enforcement (NULLs aren't compared in unique
-- constraints anyway, so the WHERE clause is redundant for
-- correctness — it just trims the index size), but Postgres won't
-- match a partial index in an ON CONFLICT (col, ...) clause unless
-- the same WHERE predicate is repeated. The Supabase JS client
-- can't pass a WHERE clause through `onConflict`, so the upsert
-- path used by the time-entries Harvest importer fails with:
--
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Drop the partial index and recreate it without the WHERE clause.
-- Functional behavior is identical — multiple rows with
-- NULL import_source_id continue to coexist (Postgres treats NULLs
-- as distinct in unique indexes by default).
--
-- The same shape exists for invoices_import_source_unique; that
-- index is fine because the invoices import path doesn't currently
-- use ON CONFLICT (it does an explicit UPDATE-or-INSERT branch),
-- but converting it for consistency is a follow-up.

DROP INDEX IF EXISTS public.time_entries_import_source_unique;

CREATE UNIQUE INDEX time_entries_import_source_unique
  ON public.time_entries (team_id, imported_from, import_source_id);
