-- ============================================================
-- Document sign-off — foundation (release notes as the first type)
-- ============================================================
--
-- A generic e-signature sign-off surface, modeled on the proposals sign-off
-- (SAL-036/037/038/042/045/046) but document-shaped (no line items / pricing /
-- tax / subset-binding). Release notes are document_type='release_notes', the
-- first of potentially many (SOWs, validation protocols…). The live proposals
-- flow is UNTOUCHED — this is a parallel table set reusing the same hardened
-- patterns.
--
-- Signature grade = proposals-parity: typed name + email OTP + a per-browser
-- view-session cookie, producing an immutable, actor-stamped, content-hashed
-- acceptance record. 21 CFR Part 11 gap-list tracked separately.
--
-- Authorization model (same as proposals): NO anon RLS grants, NO client write
-- policies on tokens/acceptances/events. The /signoff public server actions run
-- server-only and use the service-role admin client after validating the token
-- by hash + expiry + OTP + view-session. Owner/admin get SELECT for tracking.
--
-- Additive; timestamp sorts after 20260723120000.

-- ============================================================
-- 1. message_outbox.related_kind — widen for sign-off emails
-- ============================================================
ALTER TABLE public.message_outbox
  DROP CONSTRAINT IF EXISTS message_outbox_related_kind_check;
ALTER TABLE public.message_outbox
  ADD CONSTRAINT message_outbox_related_kind_check
  CHECK (related_kind IN (
    'invoice', 'invoice_reminder', 'payment_thanks',
    'proposal', 'proposal_otp', 'team_invite',
    'signoff', 'signoff_otp'
  ));

-- ============================================================
-- 2. signoff_documents (the artifact + lifecycle host)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signoff_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Optional customer the sign-off is for (AVDR = a customer). Sign-off signers
  -- are free-form (cross-org), so this is context, not the signer source.
  customer_id         UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  document_type       TEXT NOT NULL DEFAULT 'release_notes'
                        CHECK (document_type IN ('release_notes')),
  title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  version_label       TEXT CHECK (version_label IS NULL OR char_length(version_label) <= 60),
  -- Source of truth is MARKDOWN, rendered on the login-free page through
  -- MarkdownView (no rehype-raw). Never store pandoc/raw HTML here — raw HTML
  -- on a public surface is the SAL-039 XSS trap.
  body_markdown       TEXT NOT NULL CHECK (char_length(body_markdown) BETWEEN 1 AND 200000),
  external_ref        TEXT CHECK (external_ref IS NULL OR char_length(external_ref) <= 500),
  signing_mode        TEXT NOT NULL DEFAULT 'all'
                        CHECK (signing_mode IN ('all', 'first')),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','viewed','completed','declined','superseded','canceled')),
  sign_theme          TEXT NOT NULL DEFAULT 'light'
                        CHECK (sign_theme IN ('light','dark','warm')),
  sent_at             TIMESTAMPTZ,
  viewed_at           TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  declined_at         TIMESTAMPTZ,
  superseded_at       TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signoff_docs_team
  ON public.signoff_documents (team_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signoff_docs_customer
  ON public.signoff_documents (customer_id) WHERE deleted_at IS NULL;

ALTER TABLE public.signoff_documents ENABLE ROW LEVEL SECURITY;

-- Team members can read the team's sign-offs; owner/admin manage them.
DROP POLICY IF EXISTS "signoff_docs_select" ON public.signoff_documents;
CREATE POLICY "signoff_docs_select" ON public.signoff_documents FOR SELECT
  USING (public.user_has_team_access(team_id));
DROP POLICY IF EXISTS "signoff_docs_insert" ON public.signoff_documents;
CREATE POLICY "signoff_docs_insert" ON public.signoff_documents FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner','admin'));
DROP POLICY IF EXISTS "signoff_docs_update" ON public.signoff_documents;
CREATE POLICY "signoff_docs_update" ON public.signoff_documents FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner','admin'));
DROP POLICY IF EXISTS "signoff_docs_delete" ON public.signoff_documents;
CREATE POLICY "signoff_docs_delete" ON public.signoff_documents FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- Actor stamp (mirrors tg_proposals_stamp_actor).
CREATE OR REPLACE FUNCTION public.tg_signoff_docs_stamp_actor()
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
DROP TRIGGER IF EXISTS trg_signoff_docs_stamp_actor ON public.signoff_documents;
CREATE TRIGGER trg_signoff_docs_stamp_actor
  BEFORE INSERT OR UPDATE ON public.signoff_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_docs_stamp_actor();

-- Status-transition timestamps (first transition into each status only).
CREATE OR REPLACE FUNCTION public.tg_signoff_docs_status_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF    NEW.status = 'sent'       AND NEW.sent_at       IS NULL THEN NEW.sent_at := now();
    ELSIF NEW.status = 'viewed'     AND NEW.viewed_at     IS NULL THEN NEW.viewed_at := now();
    ELSIF NEW.status = 'completed'  AND NEW.completed_at  IS NULL THEN NEW.completed_at := now();
    ELSIF NEW.status = 'declined'   AND NEW.declined_at   IS NULL THEN NEW.declined_at := now();
    ELSIF NEW.status = 'superseded' AND NEW.superseded_at IS NULL THEN NEW.superseded_at := now();
    ELSIF NEW.status = 'canceled'   AND NEW.canceled_at   IS NULL THEN NEW.canceled_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_signoff_docs_status_timestamps ON public.signoff_documents;
CREATE TRIGGER trg_signoff_docs_status_timestamps
  BEFORE UPDATE ON public.signoff_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_docs_status_timestamps();

-- ============================================================
-- 3. signoff_documents_history (append-only twin)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signoff_documents_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID NOT NULL,
  team_id             UUID NOT NULL,
  operation           TEXT NOT NULL CHECK (operation IN ('UPDATE','DELETE')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state      JSONB
);
CREATE INDEX IF NOT EXISTS idx_signoff_docs_hist
  ON public.signoff_documents_history (document_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_signoff_docs_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.signoff_documents_history (
    document_id, team_id, operation, changed_by_user_id, previous_state
  ) VALUES (
    OLD.id, OLD.team_id, TG_OP, auth.uid(), to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- 'guard' (send-lock, below) < 'log' so a blocked edit RAISEs before it's logged.
DROP TRIGGER IF EXISTS trg_signoff_docs_log_change ON public.signoff_documents;
CREATE TRIGGER trg_signoff_docs_log_change
  AFTER UPDATE OR DELETE ON public.signoff_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_docs_log_change();

ALTER TABLE public.signoff_documents_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signoff_docs_hist_select" ON public.signoff_documents_history;
CREATE POLICY "signoff_docs_hist_select" ON public.signoff_documents_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- ============================================================
-- 4. Send-lock — content frozen once past draft (default-deny, SAL-034)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_signoff_docs_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  -- Columns that MAY change after a sign-off leaves draft: lifecycle status +
  -- its stamped timestamps, actor stamp, and deleted_at. Everything else —
  -- title, body_markdown, signers-implied content — is frozen; a revision is a
  -- new sign-off. DEFAULT-DENY: future columns are locked until added here.
  mutable CONSTANT text[] := ARRAY[
    'status', 'sent_at', 'viewed_at', 'completed_at', 'declined_at',
    'superseded_at', 'canceled_at', 'updated_by_user_id', 'deleted_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A non-draft sign-off is part of the audit record; soft-delete
    -- (deleted_at) is the supported removal, never a hard DELETE.
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'Sign-off "%" is % and part of the audit record — it cannot be hard-deleted.',
        OLD.title, OLD.status
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
    'Sign-off "%" was sent and its content is frozen. Create a new sign-off to make changes.',
    OLD.title
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_signoff_docs_send_lock ON public.signoff_documents;
CREATE TRIGGER trg_guard_signoff_docs_send_lock
  BEFORE UPDATE OR DELETE ON public.signoff_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_docs_send_lock_guard();

-- ============================================================
-- 5. signoff_signers (free-form cross-org roster)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signoff_signers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES public.signoff_documents(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email         TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  role_label    TEXT CHECK (role_label IS NULL OR char_length(role_label) <= 120),
  org_label     TEXT CHECK (org_label IS NULL OR char_length(org_label) <= 200),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, email)
);
CREATE INDEX IF NOT EXISTS idx_signoff_signers_doc
  ON public.signoff_signers (document_id, sort_order);

ALTER TABLE public.signoff_signers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signoff_signers_select" ON public.signoff_signers;
CREATE POLICY "signoff_signers_select" ON public.signoff_signers FOR SELECT
  USING (public.user_has_team_access(team_id));
DROP POLICY IF EXISTS "signoff_signers_insert" ON public.signoff_signers;
CREATE POLICY "signoff_signers_insert" ON public.signoff_signers FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner','admin'));
DROP POLICY IF EXISTS "signoff_signers_update" ON public.signoff_signers;
CREATE POLICY "signoff_signers_update" ON public.signoff_signers FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner','admin'));
DROP POLICY IF EXISTS "signoff_signers_delete" ON public.signoff_signers;
CREATE POLICY "signoff_signers_delete" ON public.signoff_signers FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- Roster frozen once the parent sign-off is sent (tokens are minted per signer;
-- a roster change would orphan them). Mirrors tg_psg_send_lock_guard.
CREATE OR REPLACE FUNCTION public.tg_signoff_signers_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.signoff_documents
    WHERE id = COALESCE(OLD.document_id, NEW.document_id);
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'This sign-off was sent — its signer roster is frozen. Create a new sign-off to change signers.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_signoff_signers_send_lock ON public.signoff_signers;
CREATE TRIGGER trg_guard_signoff_signers_send_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.signoff_signers
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_signers_send_lock_guard();

-- ============================================================
-- 6. signoff_tokens (public magic-link identity + OTP + view-session)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signoff_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID NOT NULL REFERENCES public.signoff_documents(id) ON DELETE CASCADE,
  team_id             UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  signer_id           UUID REFERENCES public.signoff_signers(id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,          -- sha256 of raw; raw only in the emailed URL
  signer_email        TEXT NOT NULL,
  signer_name         TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  consumed_at         TIMESTAMPTZ,
  first_viewed_at     TIMESTAMPTZ,
  otp_code_hash       TEXT,
  otp_expires_at      TIMESTAMPTZ,
  otp_attempts        INTEGER NOT NULL DEFAULT 0,
  otp_verified_at     TIMESTAMPTZ,
  view_session_hash       TEXT,
  view_session_expires_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_signoff_tokens_doc ON public.signoff_tokens (document_id);

ALTER TABLE public.signoff_tokens ENABLE ROW LEVEL SECURITY;
-- SELECT-only for owner/admin (link status). No write policies: only the
-- server-side admin client mutates token rows; the hash never leaves the server.
DROP POLICY IF EXISTS "signoff_tokens_select" ON public.signoff_tokens;
CREATE POLICY "signoff_tokens_select" ON public.signoff_tokens FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- ============================================================
-- 7. signoff_events (append-only forward log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signoff_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES public.signoff_documents(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN
                  ('created','sent','viewed','otp_sent','otp_verified','otp_failed',
                   'signed','declined','completed','link_resent','superseded','canceled')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signoff_events_doc  ON public.signoff_events (document_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_signoff_events_team ON public.signoff_events (team_id, occurred_at DESC);

ALTER TABLE public.signoff_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signoff_events_select" ON public.signoff_events;
CREATE POLICY "signoff_events_select" ON public.signoff_events FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- ============================================================
-- 8. signoff_acceptances (immutable per-signer decision record)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.signoff_acceptances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES public.signoff_documents(id) ON DELETE CASCADE,
  team_id           UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  signer_id         UUID REFERENCES public.signoff_signers(id) ON DELETE SET NULL,
  decision          TEXT NOT NULL CHECK (decision IN ('signed','declined')),
  signer_name       TEXT NOT NULL,
  signer_title      TEXT,
  signer_email      TEXT NOT NULL,
  signature_typed   TEXT,
  -- Part-11 manifestation seed: what the signer attests to (from the role).
  signature_meaning TEXT CHECK (signature_meaning IS NULL OR signature_meaning IN ('author','reviewer','approver')),
  -- Frozen snapshot of the exact document signed (markdown + metadata) + its
  -- sha256 — the defensible "what exactly was signed" anchor.
  content_snapshot  JSONB NOT NULL,
  content_sha256    TEXT NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  otp_verified_at   TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Provider counter-signature (Phase 2).
  provider_signed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_signed_at TIMESTAMPTZ,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signoff_acc_doc  ON public.signoff_acceptances (document_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_signoff_acc_team ON public.signoff_acceptances (team_id, occurred_at DESC);

-- One acceptance per (document, signer) — SAL-042 partial-index pattern
-- (NULLS-NOT-DISTINCT emulation, PG-version-independent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_signoff_acceptances_single
  ON public.signoff_acceptances (document_id) WHERE signer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signoff_acceptances_per_signer
  ON public.signoff_acceptances (document_id, signer_id) WHERE signer_id IS NOT NULL;

ALTER TABLE public.signoff_acceptances ENABLE ROW LEVEL SECURITY;
-- Immutable from the client side: SELECT-only, no INSERT/UPDATE/DELETE policies.
-- The admin client inserts the decision and (later) stamps the counter-sig.
DROP POLICY IF EXISTS "signoff_acc_select" ON public.signoff_acceptances;
CREATE POLICY "signoff_acc_select" ON public.signoff_acceptances FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- ============================================================
-- 9. Atomic OTP attempt increment (SAL-037) — service-role only
-- ============================================================
-- Max attempts hardcoded to 5 — keep in lockstep with MAX_OTP_ATTEMPTS in
-- src/lib/sign/tokens.ts.
CREATE OR REPLACE FUNCTION public.signoff_otp_attempt(p_token_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  UPDATE public.signoff_tokens
     SET otp_attempts = otp_attempts + 1
   WHERE id = p_token_id
     AND otp_attempts < 5
  RETURNING otp_attempts INTO v_attempts;
  RETURN v_attempts;  -- NULL = locked (at/over budget) or unknown token
END;
$$;
REVOKE EXECUTE ON FUNCTION public.signoff_otp_attempt(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signoff_otp_attempt(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.signoff_otp_attempt(UUID) FROM authenticated;
