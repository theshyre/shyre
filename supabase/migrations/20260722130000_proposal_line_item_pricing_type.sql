-- Per-line-item PRICING TYPE on proposals.
--
-- A proposal line item now declares WHAT KIND of pricing it is:
--   fixed_bid       — a firm price; the client pays it regardless of hours
--                     (today's sole model)
--   estimate_nte    — hourly, capped at a not-to-exceed amount ("up to $X")
--   estimate_range  — hourly, a low–high band communicated as guidance
--   estimate_tm     — hourly, no cap (time & materials); estimate is guidance
--
-- The dollar figure stays in `fixed_price` (the "anchor amount" — its MEANING
-- shifts by type: the price / the cap / the high end / the expected), so the
-- phase-sum guard (`check_proposal_phase_sums`) and every proposal total keep
-- working untouched. The sidecar columns hold the extra hourly-type inputs.
--
-- All existing rows backfill to 'fixed_bid' via the NOT NULL DEFAULT — today's
-- exact behavior, zero data migration. Additive → single-PR-safe.
--
-- proposal_line_items has NO `_v` view; every reader goes through
-- PROPOSAL_ITEM_COLUMNS, so there is no view to recreate here.
--
-- Per-type COMPLETENESS (a range needs both ends, an hourly type needs a rate)
-- is enforced at the app layer (validateProposalItems + send-readiness) so
-- save-as-you-go drafts are never blocked mid-edit; the DB holds only the
-- invariants that can never be valid (bad enum value, negative money, low>high).

ALTER TABLE proposal_line_items
  ADD COLUMN IF NOT EXISTS pricing_type TEXT NOT NULL DEFAULT 'fixed_bid',
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS estimate_low NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS estimate_high NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(10, 2);

-- Pure enum CHECK, kept as its OWN named constraint (DROP-then-ADD) so the
-- db-parity extractor — which appends only pure `CHECK (col IN (...))` ALTER
-- statements — sees the value set. Do not fold this into a compound expression.
ALTER TABLE proposal_line_items
  DROP CONSTRAINT IF EXISTS proposal_line_items_pricing_type_chk;
ALTER TABLE proposal_line_items
  ADD CONSTRAINT proposal_line_items_pricing_type_chk
  CHECK (pricing_type IN ('fixed_bid', 'estimate_nte', 'estimate_range', 'estimate_tm'));

-- Non-negativity + range ordering. Kept separate from the enum CHECK (a CASE/
-- compound expression must never shadow the pure enum in the parity extractor).
ALTER TABLE proposal_line_items
  DROP CONSTRAINT IF EXISTS proposal_line_items_pricing_nonneg_chk;
ALTER TABLE proposal_line_items
  ADD CONSTRAINT proposal_line_items_pricing_nonneg_chk
  CHECK (
    (hourly_rate IS NULL OR hourly_rate >= 0)
    AND (estimated_hours IS NULL OR estimated_hours >= 0)
    AND (estimate_low IS NULL OR estimate_low >= 0)
    AND (estimate_high IS NULL OR estimate_high >= 0)
    AND (estimate_low IS NULL OR estimate_high IS NULL OR estimate_low <= estimate_high)
  );
