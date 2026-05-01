-- Invoice discounts (additive).
--
-- Real-world driver: a Harvest invoice imported with a 100%
-- discount lost the discount on import — `subtotal=0, total=0`
-- with no record of WHY. Bookkeeper-grade: every dollar in or out
-- has to be reconcilable, so a 100% pro-bono / write-off / promo
-- discount needs to land as `subtotal=$290.40, discount=-$290.40,
-- total=$0`, not three zeros.
--
-- Three columns, additive:
--
--   discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0
--     Canonical source of truth for the dollar discount applied
--     to the invoice. CHECK: between 0 and subtotal (so total never
--     goes negative — a negative invoice is a credit memo, a
--     different document with different IRS treatment).
--
--   discount_rate    NUMERIC(5,2)
--     Percentage 0-100 the user typed (when they typed a percent
--     instead of a flat amount). Display-only — the dollar value
--     in `discount_amount` is what reconciliation uses. NULL when
--     the user entered a flat amount; non-NULL when they entered
--     a percent.
--
--   discount_reason  TEXT
--     Optional bookkeeper note ("pro bono", "loyalty discount",
--     "write-off"). Free-form for now; a small enum (pro_bono /
--     write_off / promotional / negotiated / other) is a future
--     refinement once the user surfaces patterns.
--
-- Calculation order (US norm, matches Harvest + QBO):
--   subtotal       = sum(line_items.amount)        -- already stored
--   discount_amount = (user input or rate × subtotal)
--   taxable        = subtotal − discount_amount
--   tax_amount     = round(taxable × tax_rate / 100, 2)
--   total          = taxable + tax_amount
--
-- Tax-after-discount is the US default; jurisdictions that invert
-- (some EU VAT, some manufacturer-coupon rules) get a future
-- per-business toggle. Documented here because the behavior is
-- silently load-bearing for sales-tax compliance.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_rate   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS discount_reason TEXT;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_discount_amount_nonnegative
    CHECK (discount_amount >= 0);

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_discount_amount_within_subtotal
    CHECK (
      subtotal IS NULL
      OR discount_amount <= subtotal
    );

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_discount_rate_range
    CHECK (
      discount_rate IS NULL
      OR (discount_rate >= 0 AND discount_rate <= 100)
    );

COMMENT ON COLUMN public.invoices.discount_amount IS
  'Dollar discount applied to this invoice. Canonical reconciliation source — discount_rate is display-only. Always non-negative; capped at subtotal so total cannot go negative.';

COMMENT ON COLUMN public.invoices.discount_rate IS
  'Percentage the user entered (0-100) when they specified a percent rather than a flat amount. NULL means the user entered a flat dollar amount and the rate was not specified. Display-only — discount_amount is the source of truth.';

COMMENT ON COLUMN public.invoices.discount_reason IS
  'Optional free-text note for the bookkeeper (e.g. "pro bono", "loyalty discount", "write-off"). Different reasons may have different tax treatments (pro-bono vs write-off vs promotional), so the bookkeeper needs this for reconciliation.';
