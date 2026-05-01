-- Invoice service-period + grouping-mode columns.
--
-- Two related additions to the invoices table that fall out of the
-- "Harvest-style new invoice" redesign:
--
--   period_start, period_end (DATE, nullable):
--     The service period the invoice covers. Bookkeepers + AP
--     departments key off this — "Services rendered: 2026-03-01
--     through 2026-03-31" prints on the PDF and reconciles back to
--     the time entries that produced the lines. Stored explicitly
--     instead of derived from the joined time_entries because:
--       (a) entries can be soft-deleted later, breaking min/max,
--       (b) deriving on every render is wasteful when the value
--           is fixed at invoice-creation time,
--       (c) future invoices that cover non-time work (flat fees,
--           expenses) still want a period concept.
--     Both nullable for backward compatibility — existing invoices
--     get NULL until the user re-edits or re-imports.
--
--   grouping_mode (TEXT, nullable, CHECK-constrained):
--     How line items were collapsed at creation time. Values mirror
--     Harvest's: 'by_task', 'by_person', 'by_project', 'detailed'.
--     Stored mostly for audit + the PDF's "Hours grouped by ..."
--     footer, but also the source of truth if the user later
--     regenerates line items (a planned follow-up).
--
-- Allow-list parity: src/app/(dashboard)/invoices/allow-lists.ts
-- exports ALLOWED_INVOICE_GROUPING_MODES; db-parity.test.ts pins
-- the two sets together so a typo in one will fail CI.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS period_start  DATE,
  ADD COLUMN IF NOT EXISTS period_end    DATE,
  ADD COLUMN IF NOT EXISTS grouping_mode TEXT;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_period_range_valid
    CHECK (
      period_start IS NULL
      OR period_end IS NULL
      OR period_start <= period_end
    );

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_grouping_mode_allowed
    CHECK (
      grouping_mode IS NULL
      OR grouping_mode IN ('by_task', 'by_person', 'by_project', 'detailed')
    );

COMMENT ON COLUMN public.invoices.period_start IS
  'Earliest service date covered by this invoice. Set by the new-invoice flow when a date range is chosen; can be derived from time_entries on legacy rows where NULL.';

COMMENT ON COLUMN public.invoices.period_end IS
  'Latest service date covered by this invoice. Same nullable / derive-on-legacy semantics as period_start.';

COMMENT ON COLUMN public.invoices.grouping_mode IS
  'How line items were collapsed at creation: by_task, by_person, by_project, or detailed (one line per entry). Source of truth for the PDF footer + line regeneration.';
