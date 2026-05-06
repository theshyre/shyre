-- Append-only audit trail for `projects`.
--
-- Mirrors the SAL-011 / SAL-010 / time_entries_history pattern: a
-- `*_history` row captures the pre-change state on UPDATE / DELETE,
-- written by a SECURITY DEFINER trigger the client API can never
-- call directly.
--
-- Why for projects:
--
--   - Bookkeeper persona: a project's `category_set_id` flip
--     mid-quarter silently changes what categories are pickable for
--     historical reclassification. Without an audit row, "what set
--     was on this project on March 31?" is unanswerable. Same logic
--     applies to `default_billable` — flipping it then bulk-applying
--     to historical entries (applyDefaultBillableAction) ought to
--     leave a paper trail of the project-level state change too.
--
--   - Agency-owner persona: dispute resolution. An admin who
--     reorganizes projects mid-week can't be reconstructed from
--     `updated_at` alone — that's a single timestamp with no
--     before-state.
--
--   - Audit follow-ups (2026-05-04 multi-persona audit): completes
--     the "every protected entity has an append-only history table"
--     coverage list — projects was the gap.
--
-- Snapshot strategy: full row JSONB via `to_jsonb(OLD)` so column
-- changes don't require trigger rewrites. INSERTs are NOT logged
-- (the row + its `created_at` is the creation record). Soft-delete
-- via `status = 'archived'` is logged as an UPDATE; the only
-- DELETE path is admin-driven cascade, which logs as DELETE.
--
-- updated_by_user_id is added so "Marcus archived this project on
-- April 5" surfaces directly from the row without a join.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_projects_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_stamp_actor ON public.projects;
CREATE TRIGGER trg_projects_stamp_actor
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_projects_stamp_actor();

-- ============================================================
-- projects_history
-- ============================================================

CREATE TABLE IF NOT EXISTS public.projects_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL,
  -- Denormalize team_id so the SELECT policy can role-check without
  -- joining projects (which itself may be deleted by the time the
  -- history row is read in a forensic context).
  team_id                  UUID NOT NULL,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ph_project
  ON public.projects_history (project_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ph_team
  ON public.projects_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_projects_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.projects_history (
    project_id,
    team_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
    OLD.team_id,
    TG_OP,
    auth.uid(),
    to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_log_change ON public.projects;
CREATE TRIGGER trg_projects_log_change
  BEFORE UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_projects_log_change();

ALTER TABLE public.projects_history ENABLE ROW LEVEL SECURITY;

-- Read access: owner / admin of the team only. Members don't
-- generally own project-level state changes — those are
-- administrative — and the per-row author concept doesn't apply
-- (projects don't have a single "author" column the way time_entries
-- do via user_id). If member-level visibility becomes a real ask,
-- relax this policy then.
DROP POLICY IF EXISTS "ph_select" ON public.projects_history;
CREATE POLICY "ph_select" ON public.projects_history FOR SELECT
  USING (
    public.user_team_role(team_id) IN ('owner', 'admin')
  );

-- No client INSERT / UPDATE / DELETE — only the SECURITY DEFINER
-- trigger writes. Snapshot survives the source row's deletion
-- intentionally (no FK on project_id) so a deleted project's
-- history is still queryable for forensic / dispute work.
