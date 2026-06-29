-- ============================================================
-- Expenses: first-class `external_reference` column.
--
-- Promotes the external identifier of an expense — a vendor's
-- invoice number, a purchase-order number, an order / receipt /
-- confirmation number — out of the free-form `notes` blob into its
-- own column. Deliberately generic ("any unique identifier for this
-- expense"), so it is plain free text: NO CHECK constraint and NO
-- allow-list (unlike `category`). It is NOT unique — split receipts
-- and partial payments legitimately share one document number.
--
-- Named `external_reference` (not bare `reference`) to disambiguate
-- from the Shyre-INTERNAL invoice linkage already on this table
-- (`invoice_id` / `invoiced` / `invoiced_at`). Reuse this name if a
-- future external-identifier column ever lands on time_entries or
-- invoices.
--
-- No data migration from `notes`: heuristic extraction would
-- silently rewrite historic (possibly period-locked) rows and
-- desync the CSV import dedupe hash (`import_source_id`). Existing
-- identifiers stay in `notes`; this column is populated going
-- forward only.
--
-- All additive (ADD COLUMN nullable + CREATE OR REPLACE on one
-- existing function). Safe to ship with code in one PR.
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS external_reference text;

COMMENT ON COLUMN public.expenses.external_reference IS
  'External identifier for this expense: vendor invoice #, PO #, order / receipt / confirmation number. Free text, not unique. Distinct from the Shyre-internal invoice linkage (invoice_id). Structured home for identifiers that previously lived free-form in notes.';

-- Add `external_reference` to the invoiced-lock guard's restore
-- exemption list. Mirrors 20260528160000: a restore (deleted_at
-- non-null → null) of an invoiced row is permitted only when none
-- of the editable columns changed. `external_reference` is now an
-- editable column, so it joins amount / currency / incurred_on /
-- project_id / category / vendor / billable in the IS NOT DISTINCT
-- FROM whitelist — otherwise a restore that ALSO edited the
-- reference on an invoiced row would slip past the lock. Pure
-- CREATE OR REPLACE on the function body; the existing trigger from
-- 20260528160000 keeps pointing at it (no trigger re-creation).
CREATE OR REPLACE FUNCTION public.tg_expenses_invoice_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_status TEXT;
BEGIN
  IF OLD.invoiced IS NOT TRUE OR OLD.invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  -- Invoice already void OR gone → expense is implicitly unlocked.
  IF v_invoice_status = 'void' OR v_invoice_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- UPDATE allowed only on the unlock path (clearing both fields)
  -- or a pure restore (deleted_at flipped null, nothing else changed).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.invoiced IS NOT TRUE AND NEW.invoice_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.deleted_at IS NOT NULL
       AND NEW.deleted_at IS NULL
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.incurred_on IS NOT DISTINCT FROM OLD.incurred_on
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.category IS NOT DISTINCT FROM OLD.category
       AND NEW.vendor IS NOT DISTINCT FROM OLD.vendor
       AND NEW.external_reference IS NOT DISTINCT FROM OLD.external_reference
       AND NEW.billable IS NOT DISTINCT FROM OLD.billable
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'Expense is invoiced (invoice id %). Void the invoice first, or remove this line item from it.',
    OLD.invoice_id
    USING ERRCODE = 'check_violation',
          HINT = 'Open the invoice and void it, or remove this expense line.';
END;
$$ LANGUAGE plpgsql;
