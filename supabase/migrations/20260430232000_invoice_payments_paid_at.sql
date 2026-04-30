-- Add `paid_at TIMESTAMPTZ` to invoice_payments.
--
-- The original schema has `paid_on DATE` (the calendar date the
-- payment was credited to AR), which is the right grain for
-- bookkeeping and reconciliation against bank statements. But the
-- activity log wants the actual time-of-day so "Payment received
-- at 9:26am" lines up with what the importer pulled from Harvest.
-- A DATE column drops that information.
--
-- The new `paid_at TIMESTAMPTZ` is nullable — manually-recorded
-- payments may only know the date (the user enters paid_on; we
-- can't synthesize a meaningful time of day). The activity log
-- prefers paid_at when set, falls back to paid_on midnight in
-- the team's timezone otherwise.
--
-- Additive change. No backfill: existing rows get NULL, which
-- the activity log handles via the documented fallback.

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

COMMENT ON COLUMN public.invoice_payments.paid_at IS
  'Actual paid timestamp when known (e.g. from a Harvest import). '
  'Falls back to paid_on for display when null. '
  'Distinct from created_at, which is when this Shyre row was inserted.';
