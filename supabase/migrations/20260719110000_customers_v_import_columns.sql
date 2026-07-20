-- SAL-053: /api/customers/csv read the BASE customers table, exporting raw
-- default_rate to any team member and bypassing the customers_v rate mask
-- (Phase-2a contract: every rate-displaying surface reads the _v view).
-- The route now reads customers_v — but the view's frozen column list
-- (PR #34 rule) was missing imported_from / imported_at, which the CSV
-- exports. Append them here, in the same change as the code that needs
-- them. Append-only protocol: existing column positions must not change.

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
  c.inactive_at,
  c.imported_from,
  c.imported_at
FROM public.customers c;
