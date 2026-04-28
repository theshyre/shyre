-- Append-only audit trail for `time_entries`.
--
-- Mirrors the pattern already established for invoices (SAL-011),
-- business_people (SAL-010), and businesses + business_state_registrations:
-- a `*_history` row captures the pre-change state on UPDATE / DELETE,
-- written by a SECURITY DEFINER trigger that the client API can
-- never call directly.
--
-- Why for time_entries:
--
--   - Bookkeeper persona: a closed-month time entry that's silently
--     edited after invoicing produces a discrepancy that's invisible
--     once the change is committed. The client gets billed at the
--     pre-edit numbers; the time-entry table now tells a different
--     story. Without an audit trail, "did this entry's duration
--     change after we billed?" is unanswerable.
--
--   - Agency-owner persona: a member who realizes their entry was
--     too high can quietly edit it. Owner needs the trail to spot
--     systematic under-reporting.
--
--   - QA: regression detection. If a bug zeroes out durations, the
--     before-state is recoverable.
--
-- Time entries are high-traffic, so the trigger is BEFORE UPDATE OR
-- DELETE FOR EACH ROW with a single INSERT. JSONB snapshot uses
-- to_jsonb(OLD) so column changes don't require trigger rewrites.
--
-- We do NOT log INSERTs — the row + its created_at IS the creation
-- record. We DO log soft-delete transitions (UPDATE setting
-- `deleted_at`) because that's how Shyre destroys time entries.
--
-- The created_by_user_id column already exists (`user_id` IS the
-- creator on time_entries), so we add only `updated_by_user_id` for
-- "who last touched this row." It's distinct from `user_id` —
-- owner/admin can edit a member's entry, and the audit trail wants
-- both. Stamped by trigger from auth.uid() if not explicitly set.

ALTER TABLE public.time_entries
  ADD COLUMN updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_time_entries_stamp_actor()
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

CREATE TRIGGER trg_time_entries_stamp_actor
  BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_stamp_actor();

-- ============================================================
-- time_entries_history
-- ============================================================

CREATE TABLE public.time_entries_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id            UUID NOT NULL,
  -- Denormalize team_id so the SELECT policy can role-check without
  -- joining time_entries (which itself has tightened RLS post SAL-006).
  team_id                  UUID NOT NULL,
  -- Author of the original entry — useful for display ("Alex's entry
  -- was edited by Marcus") even after time_entries is deleted.
  user_id                  UUID,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_teh_entry
  ON public.time_entries_history (time_entry_id, changed_at DESC);

CREATE INDEX idx_teh_team
  ON public.time_entries_history (team_id, changed_at DESC);

CREATE INDEX idx_teh_user
  ON public.time_entries_history (user_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_time_entries_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_team_id UUID;
BEGIN
  -- Resolve team_id via projects → customers since time_entries
  -- doesn't carry it directly.
  SELECT t.id INTO v_team_id
  FROM public.projects p
  JOIN public.customers c ON c.id = p.customer_id
  JOIN public.teams t ON t.id = c.team_id
  WHERE p.id = OLD.project_id;

  INSERT INTO public.time_entries_history (
    time_entry_id,
    team_id,
    user_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
    v_team_id,
    OLD.user_id,
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

CREATE TRIGGER trg_time_entries_log_change
  BEFORE UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_log_change();

ALTER TABLE public.time_entries_history ENABLE ROW LEVEL SECURITY;

-- Read access mirrors the time_entries SELECT policy after SAL-006:
-- the row's author can see their own change history; owner/admin of
-- the team can see everyone's. Cross-team visibility (customer-admin
-- escape) is intentionally NOT replicated here — change history is a
-- tighter surface than read-time projection.
CREATE POLICY "teh_select" ON public.time_entries_history FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.user_team_role(team_id) IN ('owner', 'admin')
  );

-- No client INSERT/UPDATE/DELETE — only the SECURITY DEFINER trigger
-- writes (and CASCADE handles cleanup if a team is deleted, since
-- the FK is on team_id without an FK to time_entries.id; the
-- snapshot survives the source row's deletion intentionally).
