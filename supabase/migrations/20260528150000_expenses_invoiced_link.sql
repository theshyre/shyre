-- ============================================================
-- Phase 2 of the expense → invoice pipeline.
--
-- Wires expenses into the invoice line-item graph so a billable
-- expense (e.g. domain renewal, AWS bill, client lunch) can land
-- on a customer invoice alongside time entries.
--
-- Additive only — no destructive changes:
--
--   1. `invoice_line_items.expense_id`   UUID, nullable FK to
--      `expenses(id)` ON DELETE SET NULL. Mirrors the existing
--      `time_entry_id` FK shape. A line item now sources from
--      either a time_entry OR an expense (mutually exclusive,
--      enforced via CHECK below), OR neither (manual line item
--      for ad-hoc charges — preserves the existing schema's
--      implicit "both null" case).
--
--   2. `expenses.invoiced` (bool, default FALSE),
--      `expenses.invoice_id` (FK to invoices ON DELETE SET NULL),
--      `expenses.invoiced_at` (timestamptz). Mirrors the
--      `time_entries.invoiced / invoice_id / created_at` trio so
--      the project-page expense row can render an "Invoiced
--      #INV-001" chip the same way the time-entry surfaces do.
--
--   3. CHECK on `invoice_line_items`: at most one of
--      `time_entry_id`, `expense_id` is non-null. Defense-in-
--      depth against an action-layer bug double-binding a line
--      item to both a time entry AND an expense (would double-
--      count the source-row writeback).
--
-- Per CLAUDE.md migration rules: additive — code that references
-- these columns ships in the same PR. No allow-list / CHECK
-- enum changes; db-parity.test.ts not affected.
-- ============================================================

-- 1. invoice_line_items.expense_id
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS expense_id UUID
    REFERENCES public.expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_expense_id
  ON public.invoice_line_items(expense_id)
  WHERE expense_id IS NOT NULL;

-- 2. invoiced/invoice_id/invoiced_at on expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_id UUID
    REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_expenses_invoice_id
  ON public.expenses(invoice_id)
  WHERE invoice_id IS NOT NULL;

-- 3. Mutual exclusivity on invoice_line_items source columns.
-- Wrapped in DO so re-running the migration after a previous
-- failed attempt doesn't trip on the constraint already existing
-- (ADD CONSTRAINT IF NOT EXISTS is not supported pre-PG17).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_line_items_source_mutex'
  ) THEN
    ALTER TABLE public.invoice_line_items
      ADD CONSTRAINT invoice_line_items_source_mutex
      CHECK (NOT (time_entry_id IS NOT NULL AND expense_id IS NOT NULL));
  END IF;
END $$;

-- Note on RLS: no new policies. The existing
-- `invoice_line_items_select/insert/update/delete` policies
-- (20260427231545) gate on parent invoice access — they remain
-- correct for expense-sourced lines. The `expenses` UPDATE
-- policy (author OR owner|admin) already permits the writeback
-- since `createInvoiceAction` is owner/admin-gated, so the
-- caller has UPDATE on every expense row in their team.
