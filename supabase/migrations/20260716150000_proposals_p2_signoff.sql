-- ============================================================
-- Proposals module — Phase 2: send + public sign-off + audit
-- ============================================================
--
-- Adds the sign-off surface (SAL-036):
--   1. proposal_access_tokens — the public magic-link identity: token stored
--      as a sha256 HASH (raw travels only in the emailed URL), expiring,
--      revocable, carrying the emailed-OTP state (hash, expiry, attempt
--      counter, verified-at). A signer must verify an emailed one-time code
--      before they can accept.
--   2. proposal_events — append-only forward lifecycle log (created / sent /
--      viewed / otp_* / accepted / declined / countersigned / …). Client-side
--      events have a NULL actor_user_id (the signer is not a Shyre user).
--   3. proposal_acceptances — the immutable acceptance record: signer name /
--      title / typed signature, the SELECTED subset snapshot + its sha256
--      (proves exactly what was accepted), computed accepted total, IP / UA,
--      OTP verification time, and the provider counter-signature.
--   4. Send-locks — a sent proposal's content is frozen (default-deny jsonb
--      strip-list, the SAL-034 pattern); edits after send become new versions
--      (P4). Lifecycle columns stay writable so status transitions work.
--   5. message_outbox.related_kind widened with 'proposal' + 'proposal_otp'
--      (sign-link + OTP emails ride the existing outbox pipeline).
--
-- Authorization model for the public path: there are NO RLS grants for anon
-- and NO write policies on these tables. The /sign server actions run
-- server-only and use the service-role admin client after validating the
-- token themselves (the outbox/logError pattern) — a client-supplied token is
-- authenticated by hash lookup + expiry + OTP, never by RLS. Team owners /
-- admins get SELECT for the activity feed and link status.
--
-- Additive; timestamp sorts after 20260716130000.

-- ============================================================
-- 1. message_outbox.related_kind — widen for proposal emails
-- ============================================================

ALTER TABLE public.message_outbox
  DROP CONSTRAINT IF EXISTS message_outbox_related_kind_check;
ALTER TABLE public.message_outbox
  ADD CONSTRAINT message_outbox_related_kind_check
  CHECK (related_kind IN ('invoice', 'invoice_reminder', 'payment_thanks', 'proposal', 'proposal_otp'));

-- ============================================================
-- 2. proposal_access_tokens
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposal_access_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  team_id             UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- sha256 hex of the raw token. The raw value exists only in the emailed URL.
  token_hash          TEXT NOT NULL UNIQUE,
  -- Signer identity frozen at send time (the contact row may change later).
  signer_email        TEXT NOT NULL,
  signer_name         TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  -- A consumed token (decision recorded) can't accept again.
  consumed_at         TIMESTAMPTZ,
  first_viewed_at     TIMESTAMPTZ,
  -- Emailed one-time code state. Hash binds the code to this token row.
  otp_code_hash       TEXT,
  otp_expires_at      TIMESTAMPTZ,
  otp_attempts        INTEGER NOT NULL DEFAULT 0,
  otp_verified_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pat_proposal ON public.proposal_access_tokens (proposal_id);

ALTER TABLE public.proposal_access_tokens ENABLE ROW LEVEL SECURITY;

-- Owner/admin can see link status (sent-to, expiry, viewed). No write
-- policies: only the server-side admin client mutates token rows, and the
-- token hash never leaves the server.
DROP POLICY IF EXISTS "pat_select" ON public.proposal_access_tokens;
CREATE POLICY "pat_select" ON public.proposal_access_tokens FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- ============================================================
-- 3. proposal_events (append-only forward log)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposal_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id    UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  team_id        UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL CHECK (event_type IN
                   ('created','sent','viewed','otp_sent','otp_verified','otp_failed',
                    'accepted','declined','countersigned','converted','superseded')),
  -- NULL for signer-side events — the client is not a Shyre user. actor_label
  -- carries a display string ("Jordan Chen (signer)") either way.
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label    TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pe_proposal ON public.proposal_events (proposal_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pe_team     ON public.proposal_events (team_id, occurred_at DESC);

ALTER TABLE public.proposal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pe_select" ON public.proposal_events;
CREATE POLICY "pe_select" ON public.proposal_events FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- ============================================================
-- 4. proposal_acceptances (immutable decision record)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposal_acceptances (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id              UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  team_id                  UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  decision                 TEXT NOT NULL CHECK (decision IN ('accepted','declined')),
  signer_name              TEXT NOT NULL,
  signer_title             TEXT,
  signer_email             TEXT NOT NULL,
  -- The typed signature string, exactly as entered.
  signature_typed          TEXT,
  -- Which top-level line items were authorized.
  selected_line_item_ids   UUID[] NOT NULL DEFAULT '{}',
  -- Frozen snapshot of the entire document as decided on (items, prices,
  -- terms, selection) + its sha256 — the defensible "what exactly was
  -- accepted" anchor, independent of later edits or versions.
  content_snapshot         JSONB NOT NULL,
  content_sha256           TEXT NOT NULL,
  accepted_total           NUMERIC(10,2),
  ip_address               TEXT,
  user_agent               TEXT,
  otp_verified_at          TIMESTAMPTZ,
  -- Provider counter-signature (both parties on the record).
  provider_signed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_signed_at       TIMESTAMPTZ,
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pa_proposal ON public.proposal_acceptances (proposal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_team     ON public.proposal_acceptances (team_id, occurred_at DESC);

ALTER TABLE public.proposal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pa_select" ON public.proposal_acceptances;
CREATE POLICY "pa_select" ON public.proposal_acceptances FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- Acceptances are immutable from the client side: no INSERT/UPDATE/DELETE
-- policies. The admin client inserts the decision and (later) stamps the
-- provider counter-signature; nothing else may touch a row.

-- ============================================================
-- 5. Send-locks — content frozen once past draft (default-deny)
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_proposals_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  -- Columns that MAY change after a proposal leaves draft: lifecycle status +
  -- its trigger-stamped timestamps, the acceptance-computed total, actor
  -- stamps, and FK columns that referential actions (ON DELETE SET NULL) must
  -- be able to clear without tripping the lock. Everything else — title,
  -- terms, dates, customer — is frozen; a revision is a NEW version (P4).
  -- DEFAULT-DENY: columns added by future migrations are locked until
  -- deliberately added here (SAL-034 lesson).
  mutable CONSTANT text[] := ARRAY[
    'status', 'sent_at', 'viewed_at', 'accepted_at', 'declined_at',
    'converted_at', 'accepted_total', 'updated_by_user_id',
    'signer_contact_id', 'supersedes_proposal_id'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'Proposal % is % and part of the audit record — it cannot be deleted.',
        OLD.proposal_number, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(OLD) - mutable) = (to_jsonb(NEW) - mutable) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Proposal % was sent and its content is frozen. Create a new version to make changes.',
    OLD.proposal_number
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- 'guard' < 'log' alphabetically, so a blocked edit RAISEs before the
-- history trigger records it (mirrors the expenses trigger-ordering note).
DROP TRIGGER IF EXISTS trg_guard_proposals_send_lock ON public.proposals;
CREATE TRIGGER trg_guard_proposals_send_lock
  BEFORE UPDATE OR DELETE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposals_send_lock_guard();

CREATE OR REPLACE FUNCTION public.tg_pli_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  -- P3's convert/billing stamps are the only post-send mutations a line item
  -- accepts. Same default-deny shape as the proposal guard.
  mutable CONSTANT text[] := ARRAY[
    'invoiced_at', 'converted_project_id', 'updated_by_user_id'
  ];
BEGIN
  SELECT status INTO v_status
  FROM public.proposals
  WHERE id = COALESCE(OLD.proposal_id, NEW.proposal_id);

  -- Parent already gone (proposal CASCADE delete of a draft) or still draft:
  -- rows are freely mutable.
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'This proposal was sent — its line items are frozen. Create a new version to make changes.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (to_jsonb(OLD) - mutable) = (to_jsonb(NEW) - mutable) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'This proposal was sent — its line items are frozen. Create a new version to make changes.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_pli_send_lock ON public.proposal_line_items;
CREATE TRIGGER trg_guard_pli_send_lock
  BEFORE UPDATE OR DELETE ON public.proposal_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_pli_send_lock_guard();
