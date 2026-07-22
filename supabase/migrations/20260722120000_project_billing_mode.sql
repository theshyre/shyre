-- Fixed-bid (fixed-price) projects. A fixed-bid engagement is priced up front;
-- the client pays that price regardless of hours, invoiced via the proposal
-- path (createInvoiceFromProposalAction). Its time is TRACKED for profitability
-- ("did we hit the number?"), NOT hourly-billed.
--
-- The bug this closes: a project converted from a fixed-price proposal line item
-- is a normal client project (is_internal=false, default_billable=true), so its
-- time sweeps into the HOURLY invoice builder ON TOP of the fixed-price invoice
-- — a silent double-bill. Marking the project fixed_bid lets the builder exclude
-- it (mirrors is_internal).
--
--   billing_mode : 'hourly' (default — every existing + ad-hoc project) | 'fixed_bid'
--   fixed_price  : the agreed price, DENORMALIZED onto the project so
--                  profitability works for ad-hoc fixed-bid projects too. The
--                  accepted proposal line item stays the sole BILLING authority
--                  (proposal_line_items.fixed_price / .invoiced_at); this copy
--                  is display/analytics only.
-- Additive -> single PR (docs/reference/migrations.md).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(10,2);

-- CHECKs use DROP-then-ADD so re-runs stay idempotent (migrations.md).
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_billing_mode_chk;
ALTER TABLE projects ADD CONSTRAINT projects_billing_mode_chk
  CHECK (billing_mode IN ('hourly', 'fixed_bid'));

-- Fixed-bid implies a paying customer — never an internal project.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_fixed_bid_has_customer_chk;
ALTER TABLE projects ADD CONSTRAINT projects_fixed_bid_has_customer_chk
  CHECK (billing_mode = 'hourly' OR is_internal = false);

-- A fixed price only makes sense on a fixed-bid project.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_fixed_price_mode_chk;
ALTER TABLE projects ADD CONSTRAINT projects_fixed_price_mode_chk
  CHECK (fixed_price IS NULL OR billing_mode = 'fixed_bid');

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_fixed_price_nonneg_chk;
ALTER TABLE projects ADD CONSTRAINT projects_fixed_price_nonneg_chk
  CHECK (fixed_price IS NULL OR fixed_price >= 0);

-- projects_v frozen-column rule: ADD COLUMN does not flow through the view, so
-- readers (loadProject) get NULL. Re-project both new columns. billing_mode is
-- an operational signal (not rate-gated); fixed_price reveals commercial shape,
-- so gate it like budget_dollars_per_period.
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
  p.rate_editability,
  p.jira_project_key,
  p.invoice_code,
  p.time_entries_visibility,
  p.is_internal,
  p.default_billable,
  p.parent_project_id,
  p.budget_hours_per_period,
  CASE
    WHEN public.can_view_project_rate(p.id)
      THEN p.budget_dollars_per_period
    ELSE NULL
  END AS budget_dollars_per_period,
  p.budget_period,
  p.budget_carryover,
  p.budget_alert_threshold_pct,
  p.projected_end_date,
  p.closed_at,
  p.closed_by_user_id,
  p.default_category_id,
  -- Appended here (20260722120000): fixed-bid billing.
  p.billing_mode,
  CASE
    WHEN public.can_view_project_rate(p.id) THEN p.fixed_price
    ELSE NULL
  END AS fixed_price
FROM public.projects p;
