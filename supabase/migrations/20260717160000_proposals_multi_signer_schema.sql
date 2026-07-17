-- ============================================================
-- Proposals v2 — multi-signer SCHEMA (additive scaffolding)
-- ============================================================
--
-- Part 1 of 2. Adds the data model for multiple signers per proposal WITHOUT
-- changing any send/sign behavior (the follow-up PR wires the per-signer send +
-- sign flow). Splitting the migration out lets the delicate uniqueness change
-- below land and validate BEFORE any code writes a per-signer acceptance.
--
--   signing_mode  — 'first' (any one signer authorizes, the current behavior)
--                   or 'all' (every rostered signer must sign the SAME subset).
--   proposal_signers — the roster: which customer contacts are asked to sign.
--   *.signer_id   — ties a token / an acceptance to a specific roster entry.
--
-- The load-bearing change is the acceptance uniqueness index (SAL-038 / SAL-042
-- below). Timestamp sorts after 20260717150000.

-- ------------------------------------------------------------
-- 1. signing_mode on proposals (allow-list ↔ CHECK: SIGNING_MODES)
-- ------------------------------------------------------------

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS signing_mode TEXT NOT NULL DEFAULT 'first'
    CHECK (signing_mode IN ('first', 'all'));

-- ------------------------------------------------------------
-- 2. proposal_signers roster (modeled on proposal_line_items)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.proposal_signers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id        UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  -- Denormalized so RLS scopes without joining proposals.
  team_id            UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES public.customer_contacts(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- One roster slot per contact per proposal.
  UNIQUE (proposal_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_proposal_signers_proposal
  ON public.proposal_signers (proposal_id, sort_order);

ALTER TABLE public.proposal_signers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psg_select" ON public.proposal_signers;
CREATE POLICY "psg_select" ON public.proposal_signers FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));
DROP POLICY IF EXISTS "psg_insert" ON public.proposal_signers;
CREATE POLICY "psg_insert" ON public.proposal_signers FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));
DROP POLICY IF EXISTS "psg_update" ON public.proposal_signers;
CREATE POLICY "psg_update" ON public.proposal_signers FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));
DROP POLICY IF EXISTS "psg_delete" ON public.proposal_signers;
CREATE POLICY "psg_delete" ON public.proposal_signers FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- Actor stamp (mirrors tg_proposal_line_items_stamp_actor).
CREATE OR REPLACE FUNCTION public.tg_proposal_signers_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_psg_stamp_actor ON public.proposal_signers;
CREATE TRIGGER trg_psg_stamp_actor
  BEFORE INSERT OR UPDATE ON public.proposal_signers
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposal_signers_stamp_actor();

-- Send-lock: the roster is frozen once the proposal leaves draft (tokens are
-- minted per signer at send; a later roster change would orphan them). Mirrors
-- the line-item / proposal send-locks — a revision is a new version.
CREATE OR REPLACE FUNCTION public.tg_psg_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.proposals
  WHERE id = COALESCE(OLD.proposal_id, NEW.proposal_id);

  -- Parent gone (CASCADE delete of a draft) or still draft → freely mutable.
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'The signer roster is frozen once a proposal is sent. Create a new version to change signers.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_psg_send_lock ON public.proposal_signers;
CREATE TRIGGER trg_guard_psg_send_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.proposal_signers
  FOR EACH ROW EXECUTE FUNCTION public.tg_psg_send_lock_guard();

-- ------------------------------------------------------------
-- 3. signer_id on tokens + acceptances
-- ------------------------------------------------------------

ALTER TABLE public.proposal_access_tokens
  ADD COLUMN IF NOT EXISTS signer_id UUID
    REFERENCES public.proposal_signers(id) ON DELETE CASCADE;

ALTER TABLE public.proposal_acceptances
  ADD COLUMN IF NOT EXISTS signer_id UUID
    REFERENCES public.proposal_signers(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 4. Uniqueness: one acceptance per (proposal, signer) — SAL-042
-- ------------------------------------------------------------
--
-- SAL-038 enforced exactly ONE acceptance per proposal via
-- uq_proposal_acceptances_proposal(proposal_id). Multi-signer needs one
-- acceptance PER SIGNER (in 'all' mode). We replace it with TWO PARTIAL unique
-- indexes — equivalent to `(proposal_id, signer_id) NULLS NOT DISTINCT` but
-- without depending on a Postgres 15+ feature (prod DB version isn't pinned):
--
--   * signer_id IS NULL  → unique on (proposal_id): the legacy / single-signer
--     path still allows only ONE acceptance per proposal — SAL-038 preserved
--     exactly (two NULL-signer acceptances on one proposal still collide).
--   * signer_id IS NOT NULL → unique on (proposal_id, signer_id): each signer
--     gets at most one acceptance.

DROP INDEX IF EXISTS uq_proposal_acceptances_proposal;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_acceptances_single
  ON public.proposal_acceptances (proposal_id)
  WHERE signer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_acceptances_per_signer
  ON public.proposal_acceptances (proposal_id, signer_id)
  WHERE signer_id IS NOT NULL;
