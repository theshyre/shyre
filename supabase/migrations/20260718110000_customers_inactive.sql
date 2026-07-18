-- Customer Active/Inactive (2026-07-18, three-lens review converged).
--
-- `inactive_at` marks a DORMANT relationship: the customer stays visible in
-- lists (badged), is bottom-grouped in new-work pickers, and keeps all
-- history in filters/reports/exports. Orthogonal to `archived` (the hidden
-- trash layer) — deliberately NOT folded into a status enum: converting the
-- live `archived` boolean would be an expand-contract migration across 13
-- call sites for zero UX gain, and this table already expresses point-in-time
-- flags as nullable timestamps (`bounced_at`, `complained_at`). NULL = active,
-- so every existing row is correct with no backfill, and the timestamp
-- answers "inactive since when?".
--
-- The view is refreshed IN THE SAME migration per the `*_v` frozen-column
-- rule (docs/reference/migrations.md; the 20260717210000 blank-logo
-- incident): column list copied verbatim from the previous definition with
-- `c.inactive_at` appended at the end.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customers.inactive_at IS
  'Dormant-relationship marker (NULL = active). Visible-but-dormant: stays in lists, bottom-grouped in creation pickers, full history retained. Orthogonal to archived (trash).';

CREATE OR REPLACE VIEW public.customers_v
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
  c.show_country_on_invoice,
  c.bounced_at,
  c.complained_at,
  c.bounce_reason,
  c.created_at,
  c.archived,
  c.team_id,
  c.is_sample,
  c.rate_visibility,
  c.rate_editability,
  c.accent_color,
  c.logo_url,
  c.inactive_at
FROM public.customers c;
