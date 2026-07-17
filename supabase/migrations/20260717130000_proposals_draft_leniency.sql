-- ============================================================
-- Proposals v2 — save-as-you-go drafts (phase-sum backstop, draft-aware)
-- ============================================================
--
-- Save-draft lets an author persist a work-in-progress proposal with whatever
-- they have so far — no title, no items, or a phased item whose phases don't
-- yet sum to its price. The P4 phase-sum backstop (statement triggers on
-- proposal_line_items) currently RAISEs on ANY mismatched breakdown, which
-- blocks saving an in-progress draft.
--
-- Fix: make the backstop DRAFT-AWARE.
--   * The line-item triggers now check only NON-draft proposals — a draft's
--     items are free to be inconsistent while it's being written.
--   * A new BEFORE UPDATE trigger on `proposals` enforces the phase sums at the
--     draft → (sent/anything) transition — the moment the document is frozen
--     and goes out. That's where the guarantee actually has to hold, and it
--     catches a direct status flip that bypasses the action layer.
--
-- The completeness gate the AUTHOR sees (title, ≥1 item, a signer) lives in the
-- action layer (`proposalSendReadiness`) with a friendly checklist; this
-- migration is only the money-integrity backstop for phase sums.
--
-- Additive (CREATE OR REPLACE on existing functions + one new trigger). The
-- core `check_proposal_phase_sums(ids)` is unchanged and still always enforces
-- over the ids it's given — the callers decide which ids to pass.
--
-- Timestamp sorts after 20260717120000.

-- ------------------------------------------------------------
-- 1. Line-item triggers: exempt drafts (pass only non-draft ids)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_pli_phase_sums_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.check_proposal_phase_sums(
    ARRAY(
      SELECT DISTINCT nr.proposal_id
      FROM new_rows nr
      JOIN public.proposals p ON p.id = nr.proposal_id
      WHERE p.status <> 'draft'
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_pli_phase_sums_upd()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.check_proposal_phase_sums(
    ARRAY(
      SELECT DISTINCT pid FROM (
        SELECT proposal_id AS pid FROM new_rows
        UNION
        SELECT proposal_id AS pid FROM old_rows
      ) ids
      JOIN public.proposals p ON p.id = ids.pid
      WHERE p.status <> 'draft'
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_pli_phase_sums_del()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.check_proposal_phase_sums(
    ARRAY(
      SELECT DISTINCT orr.proposal_id
      FROM old_rows orr
      JOIN public.proposals p ON p.id = orr.proposal_id
      WHERE p.status <> 'draft'
    )
  );
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 2. Enforce phase sums when a draft leaves draft (goes out)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_proposals_phase_sums_on_send()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- The line-item triggers skip drafts, so a draft can hold a mismatched
  -- breakdown. The instant it leaves draft the breakdown must be exact — this
  -- is the real enforcement point, and it fires even on a raw status UPDATE
  -- that never touched the line items.
  IF OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft' THEN
    PERFORM public.check_proposal_phase_sums(ARRAY[NEW.id]);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_phase_sums_on_send ON public.proposals;
CREATE TRIGGER trg_proposals_phase_sums_on_send
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposals_phase_sums_on_send();
