-- Lifetime dollar cap on a project — where a NOT-TO-EXCEED (NTE) proposal line
-- item's cap lands when it converts to an hourly project.
--
-- Distinct from `budget_dollars_per_period` (a RECURRING retainer cap that
-- requires a budget_period): this is a whole-engagement ceiling, parallel to
-- the lifetime `budget_hours`. The project bills hourly from time entries at
-- its rate; `budget_dollars` is the cap that the burn-vs-budget tooling alerts
-- against. (A HARD invoice-time stop + overage write-down is a separate,
-- platform-wide "enforcing budgets" follow-up — today budgets alert, per the
-- existing `budget_alert_threshold_pct` model.)
--
-- Additive → single-PR-safe.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS budget_dollars NUMERIC(12, 2);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_budget_dollars_nonneg_chk;
ALTER TABLE projects ADD CONSTRAINT projects_budget_dollars_nonneg_chk
  CHECK (budget_dollars IS NULL OR budget_dollars >= 0);

-- projects_v frozen-column rule: ADD COLUMN does not flow through the view, so
-- list pages / loaders read NULL until the view is recreated. Rate-gate the cap
-- (it reveals commercial shape) exactly like budget_dollars_per_period and
-- fixed_price already are.
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
  p.billing_mode,
  CASE
    WHEN public.can_view_project_rate(p.id) THEN p.fixed_price
    ELSE NULL
  END AS fixed_price,
  -- Appended here (20260722140000): lifetime dollar cap (NTE).
  CASE
    WHEN public.can_view_project_rate(p.id) THEN p.budget_dollars
    ELSE NULL
  END AS budget_dollars
FROM public.projects p;
