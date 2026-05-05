-- Sub-projects: one-level-deep parent/child relationship on projects.
--
-- Use case: a customer (e.g. EyeReg Consulting) has one application-level
-- project (AVDR eClinical) that's been the home of all their work. A
-- new bounded engagement under the same application — a multi-phase
-- framework upgrade — needs phase-level budget tracking and clean
-- per-phase invoicing without losing the umbrella context. Sibling
-- projects work but lose the umbrella; sub-projects keep both.
--
-- This migration adds:
--
--   1. `parent_project_id UUID NULL REFERENCES projects(id)
--      ON DELETE RESTRICT` — opt-in nesting. Defaults null = top-level.
--   2. Row-local CHECK (id != parent_project_id) — self-reference
--      guard. Belt-and-suspenders alongside the trigger.
--   3. Trigger `projects_enforce_parent_invariants` (BEFORE INSERT
--      OR UPDATE OF parent_project_id, customer_id, team_id) that
--      enforces:
--        a. parent.customer_id = child.customer_id (same customer)
--        b. parent.team_id = child.team_id (same team)
--        c. parent.parent_project_id IS NULL (1 level deep — no
--           grandchildren)
--        d. parent must exist (FK already enforces, but the trigger
--           emits a friendlier error)
--      The trigger uses SELECT ... FOR UPDATE on the parent row to
--      serialize concurrent re-parenting that could otherwise create
--      a 2-cycle (Tx-A re-parents X → Y, Tx-B re-parents Y → X, both
--      pass their depth checks, both commit). FOR UPDATE blocks the
--      second tx until the first commits, then sees the new state.
--   4. Trigger `projects_block_customer_change_with_children` rejects
--      UPDATEs that change customer_id on a project with children.
--      Cleaner than cascade-validating; pushes the user to detach
--      children first.
--   5. Drop-and-recreate `projects_v` with `parent_project_id`
--      appended at the tail, per the view-column-order rule
--      established in 20260504190000_internal_projects.sql.
--
-- ON DELETE RESTRICT is deliberate: SET NULL would silently orphan
-- phase projects from their parent (bad audit trail), and CASCADE
-- would delete child entries' time data along with the parent (very
-- bad). Callers must detach children before deleting a parent — the
-- action layer surfaces this as a friendly userMessage.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS parent_project_id UUID
    REFERENCES projects(id) ON DELETE RESTRICT;

-- Self-reference guard. Row-local — runs before the trigger. Cheap.
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_no_self_parent;
ALTER TABLE projects
  ADD CONSTRAINT projects_no_self_parent
    CHECK (parent_project_id IS NULL OR id <> parent_project_id);

-- Index for "list children of project X" — drives the rollup totals
-- card on the parent detail page and the hierarchical /projects
-- list. Partial because most projects are top-level.
CREATE INDEX IF NOT EXISTS idx_projects_parent
  ON projects (parent_project_id)
  WHERE parent_project_id IS NOT NULL;

-- Cross-row invariants — implemented as a trigger because CHECK
-- constraints can't reference other rows.
CREATE OR REPLACE FUNCTION public.projects_enforce_parent_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent RECORD;
BEGIN
  -- Pass-through when no parent: top-level project. The OR-condition
  -- exits cheaply for the >99% case.
  IF NEW.parent_project_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lock the parent row for the duration of THIS transaction. Two
  -- concurrent transactions trying to create a cycle (Tx-A makes X a
  -- child of Y; Tx-B makes Y a child of X) will serialize on the
  -- FOR UPDATE — whichever runs second will see the other's commit
  -- and reject, instead of both passing under READ COMMITTED.
  SELECT id, customer_id, team_id, parent_project_id
    INTO v_parent
    FROM public.projects
   WHERE id = NEW.parent_project_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent project not found'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_parent.parent_project_id IS NOT NULL THEN
    RAISE EXCEPTION 'Sub-projects cannot be nested more than one level deep'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_parent.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'Sub-project must belong to the same customer as its parent'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_parent.team_id IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'Sub-project must belong to the same team as its parent'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_enforce_parent_invariants ON projects;
CREATE TRIGGER trg_projects_enforce_parent_invariants
  BEFORE INSERT OR UPDATE OF parent_project_id, customer_id, team_id
  ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_enforce_parent_invariants();

-- A separate, simpler trigger to reject customer reassignment on
-- a project that has children. Without this, a parent project's
-- customer_id could change to a customer that doesn't match the
-- children — silently breaking the same-customer invariant. The
-- trigger above guards INSERT + UPDATE on the CHILD; this one
-- guards UPDATE on the PARENT.
CREATE OR REPLACE FUNCTION public.projects_block_customer_change_with_children()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_child_count INTEGER;
BEGIN
  IF NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
     AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_child_count
    FROM public.projects
   WHERE parent_project_id = NEW.id;

  IF v_child_count > 0 THEN
    RAISE EXCEPTION 'Cannot change customer or team on a project with sub-projects. Detach the sub-projects first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_block_customer_change_with_children ON projects;
CREATE TRIGGER trg_projects_block_customer_change_with_children
  BEFORE UPDATE OF customer_id, team_id ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.projects_block_customer_change_with_children();

-- Recreate projects_v to surface parent_project_id. Rule from
-- 20260504190000_internal_projects.sql: existing columns stay byte-
-- identical in the original order; new columns are appended strictly
-- at the tail.
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
  -- Appended in this migration.
  p.parent_project_id
FROM public.projects p;
