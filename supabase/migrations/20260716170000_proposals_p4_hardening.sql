-- ============================================================
-- Proposals module — Phase 4: security fixes (SAL-037/038) + hardening
-- ============================================================
--
-- Part A (SAL-037, High): the OTP attempt counter was a read-then-write —
-- parallel guesses all read attempts=0 and wrote 1, so the 5-try budget was
-- bypassable and brute force left no audit trace. Replaced with an ATOMIC
-- conditional increment: one UPDATE that only fires while under budget and
-- returns the new count; no row returned = locked. (The SAL-021/025
-- racy-quota lesson, applied to the public sign surface.)
--
-- Part B (SAL-038): the single-decision guarantee raced too — concurrent
-- submits could both insert an acceptance. The service now CONSUMES the
-- token first (conditional update), and this unique index is the DB-level
-- backstop: one decision record per proposal, ever.
--
-- Part C: the deferred DB-level phase-sum guard (defense-in-depth over the
-- action-layer validation).

-- ============================================================
-- A. Atomic OTP attempt increment (SAL-037)
-- ============================================================

-- Max attempts hardcoded to 5 — keep in lockstep with MAX_OTP_ATTEMPTS in
-- src/lib/proposals/tokens.ts.
CREATE OR REPLACE FUNCTION public.proposal_otp_attempt(p_token_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  UPDATE public.proposal_access_tokens
     SET otp_attempts = otp_attempts + 1
   WHERE id = p_token_id
     AND otp_attempts < 5
  RETURNING otp_attempts INTO v_attempts;
  -- NULL = already at/over budget (locked) or unknown token.
  RETURN v_attempts;
END;
$$;

-- Callable only via the service-role admin client; revoke from user roles so
-- an authenticated user can't burn someone's attempt budget.
REVOKE EXECUTE ON FUNCTION public.proposal_otp_attempt(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.proposal_otp_attempt(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.proposal_otp_attempt(UUID) FROM authenticated;

-- ============================================================
-- B. One decision record per proposal (SAL-038 backstop)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_acceptances_proposal
  ON public.proposal_acceptances (proposal_id);

-- ============================================================
-- C. DB-level phase-sum guard
-- ============================================================
--
-- P1 enforced the phase rules (a phased item's phases sum EXACTLY to the
-- item's fixed price) at the action layer via the shared domain validator.
-- This migration adds the deferred database backstop so no future write path
-- can persist a mismatched breakdown — the same defense-in-depth posture as
-- the allow-list CHECKs.
--
-- Shape: statement-level AFTER triggers with transition tables (one per DML
-- verb — Postgres allows a single event per transition-table trigger). Each
-- fires the shared checker over the affected proposals' CURRENT rows, so the
-- app's multi-request write flow stays legal at every step:
--   1. DELETE all items        → proposals have no items (vacuously valid)
--   2. INSERT parents          → items with zero phases (valid)
--   3. INSERT phases           → sums must now match (ENFORCED here)
-- Convert/billing single-column updates re-check and pass unchanged.
--
-- Additive; timestamp sorts after 20260716150000.

CREATE OR REPLACE FUNCTION public.check_proposal_phase_sums(
  p_proposal_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  bad RECORD;
BEGIN
  -- For every affected proposal: any top-level item that HAS phases must
  -- have them sum exactly to its fixed price. Unphased items are exempt.
  SELECT parent.id AS item_id,
         parent.title,
         parent.fixed_price,
         SUM(phase.fixed_price) AS phase_sum
    INTO bad
    FROM public.proposal_line_items parent
    JOIN public.proposal_line_items phase
      ON phase.parent_line_item_id = parent.id
   WHERE parent.proposal_id = ANY (p_proposal_ids)
     AND parent.parent_line_item_id IS NULL
   GROUP BY parent.id, parent.title, parent.fixed_price
  HAVING SUM(phase.fixed_price) <> parent.fixed_price
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Line item "%" has phases totaling % but a fixed price of % — phases must sum exactly to the item price.',
      bad.title, bad.phase_sum, bad.fixed_price
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_pli_phase_sums_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.check_proposal_phase_sums(
    ARRAY(SELECT DISTINCT proposal_id FROM new_rows)
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
      SELECT DISTINCT proposal_id FROM new_rows
      UNION
      SELECT DISTINCT proposal_id FROM old_rows
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
    ARRAY(SELECT DISTINCT proposal_id FROM old_rows)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_z_pli_phase_sums_ins ON public.proposal_line_items;
CREATE TRIGGER trg_z_pli_phase_sums_ins
  AFTER INSERT ON public.proposal_line_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pli_phase_sums_ins();

DROP TRIGGER IF EXISTS trg_z_pli_phase_sums_upd ON public.proposal_line_items;
CREATE TRIGGER trg_z_pli_phase_sums_upd
  AFTER UPDATE ON public.proposal_line_items
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pli_phase_sums_upd();

DROP TRIGGER IF EXISTS trg_z_pli_phase_sums_del ON public.proposal_line_items;
CREATE TRIGGER trg_z_pli_phase_sums_del
  AFTER DELETE ON public.proposal_line_items
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_pli_phase_sums_del();
