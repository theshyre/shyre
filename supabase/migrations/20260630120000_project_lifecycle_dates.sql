-- Project lifecycle dates + close-out.
--
-- Adds three additive, nullable columns to `projects`:
--
--   1. `projected_end_date DATE` — planning-only forecast of when the
--      engagement is expected to wrap. User-typed, freely editable,
--      never feeds a financial total. Drives the "overdue" badge
--      (projected_end_date < today AND status IN active/paused).
--   2. `closed_at TIMESTAMPTZ` — the close-out moment. A system-stamped
--      lifecycle event (parallel to created_at), NOT a revenue date.
--      Non-null iff the project is in a terminal status.
--   3. `closed_by_user_id UUID` — actor who closed it, for the audit
--      trail without diffing projects_history JSON.
--
-- Design decision (5-persona review, 2026-06-30): "close out" is NOT a
-- new status value. It is the transition into the EXISTING `completed`
-- status, stamped with closed_at. Reasons:
--   - `completed` already drops the project from every time-entry
--     picker (.eq("status","active")), so "no new time on a closed
--     project" already works — no new query surface.
--   - A 5th status ('closed') next to `completed`/`archived` would
--     create three overlapping "done-ish" states and force the
--     allow-list ↔ CHECK ↔ db-parity widening chain. Reusing
--     `completed` keeps the vocabulary at four and touches no CHECK.
--
-- Lock strength is intentionally SOFT: closing hides the project from
-- pickers (already true for `completed`) but does NOT add a DB block on
-- time_entries. A hard freeze is the period-lock's job (team_period_locks),
-- not the project's. Reopen stays a one-click status flip.
--
-- DATE vs TIMESTAMPTZ rule: user-picked calendar dates are DATE
-- (matches invoices.issued_date/due_date); system-stamped lifecycle
-- events are TIMESTAMPTZ (matches created_at).
--
-- Purely additive: every existing row gets NULLs, which pass the new
-- CHECK immediately. Single PR per docs/reference/migrations.md.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS projected_end_date DATE,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Couple closed_at to status: a close date only makes sense on a
-- terminal project. Belt-and-suspenders alongside the stamping trigger
-- below — the trigger keeps them in sync, the CHECK makes a desynced
-- state unrepresentable. Passes on all existing rows (closed_at NULL).
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_closed_at_requires_terminal_status;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_closed_at_requires_terminal_status
    CHECK (closed_at IS NULL OR status IN ('completed', 'archived'));

-- ============================================================
-- Stamp / clear closed_at + closed_by_user_id on status transitions.
-- Mirrors tg_projects_stamp_actor (20260506050000): a BEFORE-UPDATE
-- trigger that maintains a denormalized actor/timestamp so the row is
-- self-describing without a history join.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_projects_stamp_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Close-out: first transition into 'completed' stamps the close
  -- moment + actor. A caller-supplied closed_at (e.g. an admin
  -- backdating the close) is respected; only auto-fill when absent.
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    NEW.closed_by_user_id := COALESCE(NEW.closed_by_user_id, auth.uid());

  -- Reopen: leaving a terminal status back to a live one clears the
  -- close stamps so the row never claims a close it no longer holds.
  -- (Required by the CHECK above, which forbids closed_at on a live
  -- project.)
  ELSIF NEW.status IN ('active', 'paused')
        AND OLD.status IN ('completed', 'archived') THEN
    NEW.closed_at := NULL;
    NEW.closed_by_user_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_stamp_closed_at ON public.projects;
CREATE TRIGGER trg_projects_stamp_closed_at
  BEFORE UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_projects_stamp_closed_at();

-- ============================================================
-- Block closing a parent that still has open sub-projects.
-- Same instinct as projects_block_customer_change_with_children
-- (20260505160000): a parent operation must never leave children in an
-- incoherent state. "Engagement completed, but Phase 2 still active and
-- accepting time" contradicts close-out, so block it and push the user
-- to close/archive the children first. The action layer surfaces this
-- as a friendly userMessage.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_projects_block_close_with_open_children()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF EXISTS (
      SELECT 1 FROM public.projects c
       WHERE c.parent_project_id = NEW.id
         AND c.status NOT IN ('completed', 'archived')
    ) THEN
      RAISE EXCEPTION 'Cannot close a project with open sub-projects. Close or archive the sub-projects first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Named with a 'b' prefix so it fires (alphabetically) before
-- trg_projects_stamp_closed_at — a blocked close never stamps.
DROP TRIGGER IF EXISTS trg_projects_block_close_with_open_children ON public.projects;
CREATE TRIGGER trg_projects_block_close_with_open_children
  BEFORE UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_projects_block_close_with_open_children();

-- ============================================================
-- Recreate projects_v with the three new columns appended at the tail.
-- Rule (20260504190000 / 20260505160000 / 20260506160000): existing
-- columns stay byte-identical in original order; new columns are
-- appended strictly at the end. The lifecycle columns are operational
-- metadata, not commercial rates, so they are NOT rate-gated.
-- ============================================================
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
  -- Appended in 20260506160000_project_recurring_budgets.sql.
  p.budget_hours_per_period,
  CASE
    WHEN public.can_view_project_rate(p.id)
      THEN p.budget_dollars_per_period
    ELSE NULL
  END AS budget_dollars_per_period,
  p.budget_period,
  p.budget_carryover,
  p.budget_alert_threshold_pct,
  -- Appended in 20260630120000_project_lifecycle_dates.sql.
  p.projected_end_date,
  p.closed_at,
  p.closed_by_user_id
FROM public.projects p;
