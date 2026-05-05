-- First-class "internal projects" concept.
--
-- Pre-2026-05-04: a project's `customer_id` was nullable (since migration
-- 005) and the new-project form already had an "Internal project" option
-- that left it blank. But the concept was never finished — there was no
-- way to distinguish "intentionally internal" from "draft, no customer
-- assigned yet," no project-level default for `time_entries.billable`,
-- and downstream consumers (invoice creation, customer detail page)
-- weren't aware of the case. Result: marking a project internal in the
-- UI was a half-implementation that leaked customer-shaped assumptions
-- everywhere.
--
-- This migration adds:
--
--   1. `is_internal BOOLEAN NOT NULL DEFAULT false` — explicit flag.
--      `customer_id IS NULL` is no longer the sole indicator.
--   2. `default_billable BOOLEAN NOT NULL DEFAULT true` — drives the
--      default for new time entries on this project. The user requested
--      this specifically: "if a project starts off with not being
--      billable and needs to switch we need a pathway for that."
--      Per-entry override still works for the one-off case.
--   3. CHECK constraint — `is_internal` and `customer_id` are mutually
--      exclusive: internal ⇔ no customer; external ⇔ has customer.
--   4. Backfill — any pre-existing `customer_id IS NULL` row becomes
--      `is_internal = true` and `default_billable = false` so the new
--      CHECK constraint is satisfied without invalidating data.
--   5. Partial index for the "list internal projects on a team" lookup.
--
-- Server-side billable enforcement (entries on internal projects are
-- forced to billable=false regardless of submitted value) lives in the
-- relevant server actions (entries/actions.ts), not the DB. The CHECK
-- constraint here is per-project; cross-table invariants are enforced
-- at the boundary so inserts don't pay the join cost.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_billable BOOLEAN NOT NULL DEFAULT true;

-- Backfill BEFORE adding the CHECK constraint. Any project that was
-- created without a customer_id (via the existing "Internal project"
-- option) is reclassified as formally internal and non-billable by
-- default.
UPDATE projects
  SET is_internal = true, default_billable = false
  WHERE customer_id IS NULL AND is_internal = false;

-- Mutually exclusive: a project either has a customer (external) or
-- has no customer and is flagged internal. No silent third state.
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_internal_xor_customer;
ALTER TABLE projects
  ADD CONSTRAINT projects_internal_xor_customer
    CHECK (
      (is_internal = true AND customer_id IS NULL)
      OR (is_internal = false AND customer_id IS NOT NULL)
    );

-- Partial index for "internal projects on team X" — drives reports +
-- dashboard segmentation. Tiny since most projects are external.
CREATE INDEX IF NOT EXISTS idx_projects_team_internal
  ON projects (team_id, name)
  WHERE is_internal = true;

-- projects_v needs to surface the two new columns so the project
-- detail page (which reads from the view) can hand them to the edit
-- form. The view also picks up `jira_project_key`, `invoice_code`,
-- and `time_entries_visibility` here — these were added to the
-- underlying `projects` table in later migrations but never
-- back-patched into the view, so the edit form was silently
-- defaulting them to empty on every render. CREATE OR REPLACE VIEW
-- requires re-stating the full select, so we do it once here.
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
  p.jira_project_key,
  p.invoice_code,
  p.status,
  p.created_at,
  p.team_id,
  p.category_set_id,
  p.require_timestamps,
  p.time_entries_visibility,
  p.is_sample,
  p.rate_visibility,
  p.rate_editability,
  p.is_internal,
  p.default_billable
FROM public.projects p;
