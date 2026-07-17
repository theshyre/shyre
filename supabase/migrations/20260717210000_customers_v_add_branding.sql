-- Expose the customer co-brand columns on customers_v.
--
-- 20260717150000 added customers.accent_color + customers.logo_url to the base
-- table, but the customers_v view (whose column list is frozen at creation)
-- was never refreshed — so the customer EDIT form, which reads customers_v,
-- got NULL for both. Symptom: an uploaded customer logo showed on first upload
-- and on the proposal, but the edit form's logo (and accent) came up blank on
-- re-open.
--
-- CREATE OR REPLACE (not DROP + CREATE) preserves the view's grants + security
-- options; the two new columns are appended at the end, which is all
-- CREATE OR REPLACE allows. The existing column list is copied verbatim from
-- the latest definition (20260503000000_messaging_platform.sql).
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
  c.logo_url
FROM public.customers c;
