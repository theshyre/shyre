-- Payment terms (Net 30 / Net 60 / Due on receipt / etc.)
--
-- Bookkeeper / AP-team requirement: every invoice should carry a
-- "Payment terms" label so the receiving accounts-payable clerk
-- doesn't have to ask "when is this due?" To support that across the
-- product, terms cascade:
--
--   customers.payment_terms_days   (per-customer override)
--     ↓ falls back to
--   team_settings.default_payment_terms_days   (team-wide default)
--     ↓ falls back to
--   null   (user picks a date manually each time)
--
-- The chosen value is denormalized onto the invoice at create-time —
-- if the customer's terms change later, historical invoices stay
-- correct. Stored as integer days plus a human label
-- ("Net 30" / "Due on receipt") so the PDF renderer doesn't need to
-- know the mapping. 0 = due on receipt.
--
-- Validation: 0..365 inclusive. Anything past a year is almost
-- certainly a typo (and most contracts cap at Net 90 anyway).

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS default_payment_terms_days INTEGER
    CHECK (default_payment_terms_days IS NULL
           OR (default_payment_terms_days >= 0
               AND default_payment_terms_days <= 365));

COMMENT ON COLUMN public.team_settings.default_payment_terms_days IS
  'Team-wide default payment terms in days. NULL = no default; user picks per invoice. 0 = due on receipt.';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER
    CHECK (payment_terms_days IS NULL
           OR (payment_terms_days >= 0
               AND payment_terms_days <= 365));

COMMENT ON COLUMN public.customers.payment_terms_days IS
  'Per-customer payment terms in days, overriding team default. NULL = inherit team_settings.default_payment_terms_days.';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER
    CHECK (payment_terms_days IS NULL
           OR (payment_terms_days >= 0
               AND payment_terms_days <= 365));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_terms_label TEXT;

COMMENT ON COLUMN public.invoices.payment_terms_days IS
  'Payment terms in days, denormalized at invoice create. Frozen so changing customer terms later does not retroactively alter sent invoices.';
COMMENT ON COLUMN public.invoices.payment_terms_label IS
  'Human label for payment terms ("Net 30" / "Due on receipt"). Denormalized alongside payment_terms_days for PDF rendering.';

-- Rewrite views to surface the new columns. Postgres refuses
-- CREATE OR REPLACE when adding columns mid-list, so we drop and
-- recreate — same approach the prior team_settings_v migrations took.
DROP VIEW IF EXISTS public.team_settings_v;

CREATE VIEW public.team_settings_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  ts.team_id,
  ts.business_name,
  ts.business_email,
  ts.business_address,
  ts.business_phone,
  ts.logo_url,
  CASE WHEN public.can_view_team_rate(ts.team_id) THEN ts.default_rate ELSE NULL END AS default_rate,
  ts.invoice_prefix,
  ts.invoice_next_num,
  ts.tax_rate,
  ts.wordmark_primary,
  ts.wordmark_secondary,
  ts.brand_color,
  ts.default_payment_terms_days,
  ts.created_at,
  ts.updated_at,
  ts.rate_visibility,
  ts.rate_editability
FROM public.team_settings ts;

DROP VIEW IF EXISTS public.customers_v;

CREATE VIEW public.customers_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  c.id,
  c.user_id,
  c.name,
  c.email,
  c.address,
  c.notes,
  CASE WHEN public.can_view_customer_rate(c.id) THEN c.default_rate ELSE NULL END AS default_rate,
  c.payment_terms_days,
  c.created_at,
  c.archived,
  c.team_id,
  c.is_sample,
  c.rate_visibility,
  c.rate_editability
FROM public.customers c;
