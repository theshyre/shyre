-- Phase 2a (3/3): column-masked views for the four rate-bearing tables.
--
-- Each view returns all columns of the underlying table, but the rate
-- column is wrapped in `CASE WHEN can_view_X(id) THEN rate ELSE NULL`.
-- App code that needs to respect rate visibility reads from these views
-- (Phase 2b migrates the relevant call sites); app code that doesn't
-- touch rate columns can continue to query the base table directly.
--
-- Security posture:
--   - security_invoker = true: view runs with the caller's RLS, so row
--     visibility on the underlying table is preserved. A member sees
--     only the rows they'd see on the base table; the rate value is
--     additionally masked by the helper.
--   - security_barrier = true: prevents the query planner from pushing
--     user-supplied expressions past the CASE, which could otherwise
--     leak the raw rate via side-channel (e.g. a WHERE clause that
--     evaluates the raw rate first).
--
-- Base-table access is not revoked — a caller can still query
-- `projects` directly and see the raw rate. The app-layer contract
-- (Phase 2b) is that any surface that displays rate data reads from
-- the _v view. Tightening this to a DB-enforced block (REVOKE SELECT
-- on rate columns from authenticated) is a future option once the app
-- migration is complete; doing it now would break every current query.

-- team_settings_v
CREATE OR REPLACE VIEW public.team_settings_v
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
  ts.created_at,
  ts.updated_at,
  ts.legal_name,
  ts.entity_type,
  ts.tax_id,
  ts.state_registration_id,
  ts.registered_state,
  ts.date_incorporated,
  ts.fiscal_year_start,
  ts.rate_visibility,
  ts.rate_editability
FROM public.team_settings ts;

-- projects_v
CREATE OR REPLACE VIEW public.projects_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  p.id,
  p.customer_id,
  p.user_id,
  p.name,
  p.description,
  CASE WHEN public.can_view_project_rate(p.id) THEN p.hourly_rate ELSE NULL END AS hourly_rate,
  p.budget_hours,
  p.github_repo,
  p.status,
  p.created_at,
  p.team_id,
  p.category_set_id,
  p.require_timestamps,
  p.is_sample,
  p.rate_visibility,
  p.rate_editability
FROM public.projects p;

-- customers_v
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
  c.created_at,
  c.archived,
  c.team_id,
  c.is_sample,
  c.rate_visibility,
  c.rate_editability
FROM public.customers c;

-- team_members_v
CREATE OR REPLACE VIEW public.team_members_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  tm.id,
  tm.team_id,
  tm.user_id,
  tm.role,
  tm.joined_at,
  CASE WHEN public.can_view_member_rate(tm.id) THEN tm.default_rate ELSE NULL END AS default_rate,
  tm.rate_visibility,
  tm.rate_editability
FROM public.team_members tm;
