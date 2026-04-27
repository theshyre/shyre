-- Invoice import audit trail.
--
-- Mirrors the audit trail added to customers / projects / time_entries
-- in 20260423120000_import_audit_trail.sql. The Harvest importer now
-- pulls invoices + line items, and we want the same idempotency +
-- cleanup-by-run-id story the other tables already have.
--
-- Four columns, all nullable (real user-entered invoices never get them):
--
--   imported_from     — 'harvest' today; widen the CHECK as new
--                       importers land.
--   imported_at       — when the import ran.
--   import_run_id     — UUID per run; "Undo import" deletes by this id.
--   import_source_id  — Harvest invoice.id, used for idempotent re-imports.
--
-- A partial unique index on (team_id, imported_from, import_source_id)
-- enforces that the same Harvest invoice can't land twice in the same
-- team. Hand-entered invoices (NULL source_id) don't participate.
--
-- invoice_line_items intentionally don't get audit columns. Line items
-- are owned by their parent invoice — re-importing an invoice replaces
-- its line items, and undoing a run deletes invoices which cascades to
-- line_items via the existing FK.

ALTER TABLE public.invoices
  ADD COLUMN imported_from    TEXT
    CHECK (imported_from IS NULL OR imported_from IN ('harvest')),
  ADD COLUMN imported_at      TIMESTAMPTZ,
  ADD COLUMN import_run_id    UUID,
  ADD COLUMN import_source_id TEXT;

CREATE UNIQUE INDEX invoices_import_source_unique
  ON public.invoices (team_id, imported_from, import_source_id)
  WHERE import_source_id IS NOT NULL;

CREATE INDEX invoices_import_run_idx
  ON public.invoices (import_run_id)
  WHERE import_run_id IS NOT NULL;
