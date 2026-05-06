-- Recurring per-period project budgets, plus a renamed semantic for
-- the existing `budget_hours` column (it now means the LIFETIME
-- ceiling — the data hasn't changed, the meaning has). See
-- `docs/reference/database-schema.md` for the documented shift.
--
-- Persona consensus drove this shape:
--
--   - Bookkeeper: hours-only caps don't model "$8k/month" retainers.
--     Add a parallel dollars cap. Carryover policy can't be a hard-
--     coded default — needs to be queryable so the books reflect
--     contract terms.
--
--   - Solo consultant: every new project nagging at 80% is a tax.
--     Threshold defaults NULL ("track only"); the user opts in by
--     setting it. quarterly is a real period that some retainers
--     use; weekly + monthly + quarterly is the realistic enum.
--
--   - Agency owner: budget reveals commercial shape (rates, retainer
--     size). Edits must follow the rate_editability gate — gated in
--     the server action, not the migration, but called out here so
--     the next person doesn't widen the surface accidentally.
--
--   - Platform architect: inline columns, not a junction. Threshold
--     gets a CHECK BETWEEN 1 AND 100 to block 0 / 150 typos. The
--     projects_v view recreate is mandatory — readers go through
--     the view, and silently-missing columns are a debugging trap.
--
-- Schema is purely additive — every existing project keeps working
-- with NULL recurring fields. CHECK constraints accept NULL so a
-- project with "no period" stays valid.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_hours_per_period NUMERIC(10, 2);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_dollars_per_period NUMERIC(12, 2);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_period TEXT;

-- 'none' is the only carryover behavior implemented in v1; the enum
-- exists so future "rolls within the quarter" or "lifetime pool"
-- contracts can land non-destructively. Default 'none' so existing
-- rows have a defined value rather than NULL — there's no
-- contractually-meaningful "carryover unset" state.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_carryover TEXT NOT NULL DEFAULT 'none';

-- Threshold is NULL by default — most projects don't want a banner.
-- Set to e.g. 80 to receive the "approaching cap" warning.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_alert_threshold_pct INTEGER;

-- Constraints: drop-then-add so a re-run lands on the same shape.
-- Standard pattern for additive constraint changes per
-- docs/reference/migrations.md (allow-list CHECKs).
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_budget_period_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_budget_period_check CHECK (
    budget_period IS NULL
    OR budget_period IN ('weekly', 'monthly', 'quarterly')
  );

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_budget_carryover_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_budget_carryover_check CHECK (
    budget_carryover IN ('none', 'within_quarter', 'lifetime')
  );

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_budget_alert_threshold_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_budget_alert_threshold_check CHECK (
    budget_alert_threshold_pct IS NULL
    OR (
      budget_alert_threshold_pct >= 1
      AND budget_alert_threshold_pct <= 100
    )
  );

-- Coherence guard: if a project sets a recurring cap (hours OR
-- dollars), it must also set a period — otherwise "30 hours per ?"
-- is meaningless. Equivalently: budget_period being NULL means no
-- recurring cap of any kind.
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_budget_period_coherence_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_budget_period_coherence_check CHECK (
    -- Either no period set AND no caps: pure overall-budget mode.
    (
      budget_period IS NULL
      AND budget_hours_per_period IS NULL
      AND budget_dollars_per_period IS NULL
    )
    OR
    -- Or a period is set: at least one cap must be non-null too.
    (
      budget_period IS NOT NULL
      AND (
        budget_hours_per_period IS NOT NULL
        OR budget_dollars_per_period IS NOT NULL
      )
    )
  );

-- Recreate projects_v to surface the new columns. Rule from
-- 20260505160000_project_parent_subprojects.sql: existing columns
-- stay byte-identical in the original order; new columns are
-- appended strictly at the tail.
CREATE OR REPLACE VIEW public.projects_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  -- Original 16 columns from the initial view definition, untouched.
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
  -- Appended in 20260504190000_internal_projects.sql.
  p.jira_project_key,
  p.invoice_code,
  p.time_entries_visibility,
  p.is_internal,
  p.default_billable,
  -- Appended in 20260505160000_project_parent_subprojects.sql.
  p.parent_project_id,
  -- Appended in this migration. budget_dollars_per_period is gated
  -- by can_view_project_rate — dollar caps reveal commercial shape
  -- the same way rates do (agency-owner persona). Hours-per-period
  -- and the period type are NOT gated; they're operational signal
  -- that contributors need to self-regulate against.
  p.budget_hours_per_period,
  CASE
    WHEN public.can_view_project_rate(p.id)
      THEN p.budget_dollars_per_period
    ELSE NULL
  END AS budget_dollars_per_period,
  p.budget_period,
  p.budget_carryover,
  p.budget_alert_threshold_pct
FROM public.projects p;
