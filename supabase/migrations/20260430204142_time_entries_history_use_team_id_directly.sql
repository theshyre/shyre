-- Fix: time_entries audit trigger fails on projects without a customer
--
-- The original audit trigger (20260428025103_time_entries_audit_trail)
-- resolved team_id by joining `projects → customers → teams`. The
-- comment claimed time_entries didn't carry team_id directly — but it
-- does, and has since the multi-tenant migration. The JOIN fails when
-- a project has no customer (`projects.customer_id` is nullable —
-- internal-work projects, sample-data projects, certain Harvest
-- imports), which makes v_team_id NULL and the INSERT fails the
-- NOT NULL check on time_entries_history.team_id:
--
--   null value in column "team_id" of relation "time_entries_history"
--   violates not-null constraint
--
-- Surfaced today on undoImportRunAction during a Harvest re-import
-- undo — bulk DELETEs of time_entries on an imported project where
-- the importer didn't attach a customer.
--
-- Fix: use OLD.team_id directly. time_entries.team_id is NOT NULL
-- and ON DELETE CASCADE, so it's always populated and always points
-- at the same team the row was logged against. This also drops three
-- joins from the per-row trigger path → faster bulk deletes.

CREATE OR REPLACE FUNCTION public.tg_time_entries_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.time_entries_history (
    time_entry_id,
    team_id,
    user_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
    OLD.team_id,
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
