-- message_outbox_history — append-only audit trail for any
-- mutation to a row whose send already happened.
--
-- Pattern mirrors invoices_history (SAL-011): trigger captures
-- previous_state as JSONB on every UPDATE / DELETE so a future
-- bookkeeper can answer "what did we send vs. what does the
-- record say now."
--
-- Filter: only capture mutations to rows whose status is past the
-- pre-delivery range (queued / sending). Pre-delivery transitions
-- are normal traffic and would flood the table without adding
-- audit value. Once a row has reached `sent` or beyond, any
-- further change is bookkeeper-relevant — content edits, status
-- flips driven by webhooks, and DELETEs all get logged.

CREATE TABLE IF NOT EXISTS public.message_outbox_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id           UUID NOT NULL,
  team_id             UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  operation           TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_outbox_history_outbox
  ON public.message_outbox_history (outbox_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_outbox_history_team
  ON public.message_outbox_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_message_outbox_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Skip pre-delivery mutations. Status transitions queued →
  -- sending → sent / failed_* are the normal traffic of the
  -- drain path and aren't audit-relevant. Once the row has
  -- reached `sent` (provider accepted) we want every further
  -- change captured — including the webhook flips to
  -- delivered / bounced / complained, since those are exactly
  -- the events bookkeepers reconstruct delivery from.
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('queued', 'sending') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.message_outbox_history (
    outbox_id, team_id, operation, changed_by_user_id, previous_state
  ) VALUES (
    OLD.id, OLD.team_id, TG_OP, auth.uid(), to_jsonb(OLD)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_message_outbox_log_change
  BEFORE UPDATE OR DELETE ON public.message_outbox
  FOR EACH ROW EXECUTE FUNCTION public.tg_message_outbox_log_change();

ALTER TABLE public.message_outbox_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "moh_select" ON public.message_outbox_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- No INSERT / UPDATE / DELETE policies for `authenticated` —
-- writes flow through the trigger only. Mirrors invoices_history.

COMMENT ON TABLE public.message_outbox_history IS
  'Append-only audit trail for message_outbox mutations after delivery. Captured by trigger on UPDATE/DELETE when the prior status was anything past queued/sending. Bookkeeper evidence for "did the rendered body change after we sent it" / "did someone tamper with the recipient list."';
