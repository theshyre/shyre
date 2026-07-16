-- ============================================================
-- Realtime team broadcast — payload-free "something changed" signal
-- ============================================================
--
-- Goal: let a loaded dashboard reflect BACKGROUND changes (a teammate logs
-- time, an invoice is paid) without a manual refresh.
--
-- Design (see SAL-035): a SECURITY DEFINER trigger on each team-scoped table
-- emits a Realtime *Broadcast* to the private topic `team:<team_id>` carrying
-- ONLY the table name — never any row data. Browser clients subscribe to
-- their own teams' topics (authorized by RLS on `realtime.messages`) and use
-- the signal to offer a user-controlled "N updates · Refresh". The refresh
-- re-fetches through the existing RLS-scoped server path, so the payload is a
-- dumb trigger, not a data source.
--
-- Why Broadcast and NOT `postgres_changes`:
--   * `postgres_changes` does not RLS-filter DELETE events, and ships
--     whole-row payloads with no column masking — either one would regress
--     the SAL-006 / SAL-011 / SAL-013 member-isolation guarantees for
--     `time_entries` / `invoices` / `expenses`.
--   * Broadcast lets us author a payload that physically contains no
--     sensitive columns, and control DELETE explicitly in the trigger.
--   * REPLICA IDENTITY stays DEFAULT (no whole-row OLD image on the wire);
--     these tables are intentionally NOT added to the `supabase_realtime`
--     publication.
--
-- Keep the set of triggered tables in sync with the module registry's
-- `realtimeTables` declarations — enforced by
-- `src/__tests__/realtime-parity.test.ts`.

-- ------------------------------------------------------------
-- Trigger function: emit {table} to team:<team_id>, no row data.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_team_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id UUID;
BEGIN
  -- OLD is only assigned on UPDATE/DELETE; NEW only on INSERT/UPDATE.
  IF (TG_OP = 'DELETE') THEN
    v_team_id := OLD.team_id;
  ELSE
    v_team_id := NEW.team_id;
  END IF;

  IF v_team_id IS NOT NULL THEN
    -- Payload is the table name ONLY. No user_id, no amounts, no notes —
    -- nothing that RLS would otherwise gate. The client treats it as an
    -- opaque "refetch me" ping.
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME), -- payload (no row data)
      'change',                                   -- event
      'team:' || v_team_id::text,                 -- topic (private, per team)
      true                                        -- private channel
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION public.broadcast_team_change() IS
  'AFTER trigger: emits a payload-free {table} Broadcast to team:<team_id> on row change. Never carries row data. See SAL-035 + realtime_team_broadcast migration.';

-- ------------------------------------------------------------
-- Attach to the team-scoped tables that drive dashboard freshness.
-- Same trigger name across tables (names are per-table). Idempotent.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS broadcast_change ON public.time_entries;
CREATE TRIGGER broadcast_change
  AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_team_change();

DROP TRIGGER IF EXISTS broadcast_change ON public.invoices;
CREATE TRIGGER broadcast_change
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_team_change();

DROP TRIGGER IF EXISTS broadcast_change ON public.expenses;
CREATE TRIGGER broadcast_change
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_team_change();

-- ------------------------------------------------------------
-- Realtime Authorization: a team member may RECEIVE broadcasts on their
-- own team's private topic, and nothing else.
--
-- A client-supplied channel filter is NOT a security boundary — this RLS
-- policy on `realtime.messages` is the only wall. It uses the existing
-- SECURITY DEFINER membership helper (`user_has_team_access`) rather than an
-- inline EXISTS, per the SAL-003 policy-recursion lesson, and derives the
-- team_id from the topic (`team:<uuid>`). `nullif(...,'')::uuid` fails closed
-- on any malformed topic.
--
-- No INSERT policy: only the SECURITY DEFINER trigger emits messages;
-- browsers never send on these channels.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "team members receive team broadcasts" ON realtime.messages;
CREATE POLICY "team members receive team broadcasts"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() LIKE 'team:%'
    AND public.user_has_team_access(
      nullif(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );
