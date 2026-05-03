-- Messaging platform foundation.
--
-- Phase 1 of the email-invoice feature. Sets up:
--   1. team_email_config            — per-team Resend (or other provider)
--                                      API key + From / Reply-To / signature /
--                                      daily-cap. API key is BYTEA;
--                                      app-side AES-256-GCM ciphertext keyed
--                                      by EMAIL_KEY_ENCRYPTION_KEY.
--   2. verified_email_domains       — Resend's domain status mirror; a row
--                                      gates which `from` addresses the team
--                                      can actually send from.
--   3. message_outbox               — generic outbound queue. Cross-cutting
--                                      platform table; invoice messages are a
--                                      view. Phase 3 (payment thanks) and any
--                                      future "send report" path reuse it.
--   4. message_outbox_events        — append-only webhook ingestion log
--                                      (delivered / bounced / complained).
--   5. message_templates            — per-team subject / body templates,
--                                      keyed by (team_id, kind). Kinds match
--                                      ALLOWED_MESSAGE_KINDS in app code;
--                                      db-parity test enforces.
--   6. user_settings.github_token_encrypted (additive)
--                                    — parallel encrypted column. Plaintext
--                                      column remains until the app's read
--                                      path migrates (CLAUDE.md two-PR rule
--                                      for destructive changes). Phase 2
--                                      drops the plaintext.
--   7. customers.bounced_at / complained_at / bounce_reason
--                                    — populated from webhook events; UI
--                                      flags the customer's email so the
--                                      next Send doesn't silently fail.
--
-- All encryption happens in app code (`src/lib/messaging/encryption.ts`).
-- The DB stores opaque ciphertext as BYTEA. The encryption key never
-- reaches Postgres; this avoids the Supabase-pooler / session-setting
-- dance that pgcrypto-in-DB would require.
--
-- RLS pattern follows SAL-010..014 lineage:
--   user_team_role(team_id) IN ('owner','admin')
-- not user_has_team_access (which is too permissive for PII / secrets).

-- ============================================================
-- 1. team_email_config — per-team provider config + secrets
-- ============================================================

CREATE TABLE IF NOT EXISTS public.team_email_config (
  team_id        UUID PRIMARY KEY
                 REFERENCES public.teams(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL DEFAULT 'resend'
                 CHECK (provider IN ('resend')),
  api_key_encrypted BYTEA,
  from_email     TEXT,
  from_name      TEXT,
  reply_to_email TEXT,
  signature      TEXT,
  daily_cap      INTEGER NOT NULL DEFAULT 50
                 CHECK (daily_cap >= 0 AND daily_cap <= 1000),
  daily_sent_count INTEGER NOT NULL DEFAULT 0,
  daily_window_starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.team_email_config ENABLE ROW LEVEL SECURITY;

-- Owner / admin only — the API key is a secret, and the daily-cap is a
-- per-team operations setting that members shouldn't be able to change.
CREATE POLICY "team_email_config_select_owner_admin"
  ON public.team_email_config FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "team_email_config_insert_owner_admin"
  ON public.team_email_config FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "team_email_config_update_owner_admin"
  ON public.team_email_config FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "team_email_config_delete_owner_admin"
  ON public.team_email_config FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE TRIGGER tg_team_email_config_set_updated_at
  BEFORE UPDATE ON public.team_email_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.team_email_config IS
  'Per-team email provider configuration. API key is encrypted in app code (AES-256-GCM).';
COMMENT ON COLUMN public.team_email_config.api_key_encrypted IS
  'AES-256-GCM ciphertext: 12-byte IV || 16-byte auth tag || ciphertext. Key from EMAIL_KEY_ENCRYPTION_KEY env. Never decrypt outside the messaging module.';

-- ============================================================
-- 2. verified_email_domains — Resend domain status mirror
-- ============================================================

CREATE TABLE IF NOT EXISTS public.verified_email_domains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL,
  provider_domain_id TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'verified', 'failed')),
  dns_records     JSONB,
  verified_at     TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, domain)
);

ALTER TABLE public.verified_email_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "verified_email_domains_select_owner_admin"
  ON public.verified_email_domains FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "verified_email_domains_insert_owner_admin"
  ON public.verified_email_domains FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "verified_email_domains_update_owner_admin"
  ON public.verified_email_domains FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "verified_email_domains_delete_owner_admin"
  ON public.verified_email_domains FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE TRIGGER tg_verified_email_domains_set_updated_at
  BEFORE UPDATE ON public.verified_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_verified_email_domains_team
  ON public.verified_email_domains(team_id);

COMMENT ON TABLE public.verified_email_domains IS
  'Mirror of provider domain-verification state. Server actions assert from_email matches a row with status=verified before sending — defense in depth, not just trusting the provider.';

-- ============================================================
-- 3. message_outbox — generic outbound queue
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_outbox (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  related_kind         TEXT NOT NULL
                       CHECK (related_kind IN ('invoice', 'invoice_reminder', 'payment_thanks')),
  related_id           UUID,
  provider             TEXT NOT NULL DEFAULT 'resend'
                       CHECK (provider IN ('resend')),
  provider_message_id  TEXT,
  from_email           TEXT NOT NULL,
  from_name            TEXT,
  reply_to_email       TEXT,
  to_email             TEXT NOT NULL,
  cc_emails            TEXT[],
  bcc_emails           TEXT[],
  subject              TEXT NOT NULL,
  body_html            TEXT,
  body_text            TEXT,
  attachments          JSONB,
  attachment_pdf_sha256 TEXT,
  idempotency_key      TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN (
                         'queued', 'sending', 'sent',
                         'delivered', 'bounced', 'complained',
                         'failed_retryable', 'failed_permanent'
                       )),
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at      TIMESTAMPTZ,
  error_message        TEXT,
  bounce_reason        TEXT,
  bounce_type          TEXT,
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  last_event_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_outbox ENABLE ROW LEVEL SECURITY;

-- SELECT owner / admin only — body_html / body_text contain rendered
-- invoice content (PII + amounts). Members below admin shouldn't read.
CREATE POLICY "message_outbox_select_owner_admin"
  ON public.message_outbox FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- No INSERT / UPDATE policies for `authenticated` role — all writes
-- go through the messaging module via the admin client. RLS is the
-- enforcement layer; the absence of a policy means non-service-role
-- callers can't write at all.

CREATE TRIGGER tg_message_outbox_set_updated_at
  BEFORE UPDATE ON public.message_outbox
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_message_outbox_team
  ON public.message_outbox(team_id);
CREATE INDEX IF NOT EXISTS idx_message_outbox_related
  ON public.message_outbox(related_kind, related_id);
CREATE INDEX IF NOT EXISTS idx_message_outbox_status_next_attempt
  ON public.message_outbox(status, next_attempt_at)
  WHERE status IN ('queued', 'failed_retryable');
CREATE INDEX IF NOT EXISTS idx_message_outbox_provider_message_id
  ON public.message_outbox(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON TABLE public.message_outbox IS
  'Generic outbound message queue. Phase 1 ships invoice sends; Phase 2 reminders; Phase 3 payment thanks. Audit trail (rendered body + pdf sha256 + provider message id) is append-only effectively — the PII rule means even owner/admin shouldn''t mutate post-send.';

-- ============================================================
-- 4. message_outbox_events — webhook ingestion log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_outbox_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id    UUID NOT NULL REFERENCES public.message_outbox(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  payload      JSONB,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_outbox_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_outbox_events_select_owner_admin"
  ON public.message_outbox_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.message_outbox o
      WHERE o.id = message_outbox_events.outbox_id
        AND public.user_team_role(o.team_id) IN ('owner', 'admin')
    )
  );

-- No INSERT policy: webhook writes use the admin client (service role).

CREATE INDEX IF NOT EXISTS idx_message_outbox_events_outbox
  ON public.message_outbox_events(outbox_id);
CREATE INDEX IF NOT EXISTS idx_message_outbox_events_received
  ON public.message_outbox_events(received_at DESC);

COMMENT ON TABLE public.message_outbox_events IS
  'Append-only webhook event log. One row per provider event (delivered, bounced, complained, opened, etc.). Drives status transitions on message_outbox.';

-- ============================================================
-- 5. message_templates — per-team default subject / body
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL
             CHECK (kind IN ('invoice_send', 'invoice_reminder', 'payment_thanks')),
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, kind)
);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_templates_select_owner_admin"
  ON public.message_templates FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "message_templates_insert_owner_admin"
  ON public.message_templates FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "message_templates_update_owner_admin"
  ON public.message_templates FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "message_templates_delete_owner_admin"
  ON public.message_templates FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE TRIGGER tg_message_templates_set_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.message_templates IS
  'Per-team default subject + body for each message kind. Allow-list of kinds mirrors ALLOWED_MESSAGE_KINDS in src/lib/allow-lists.ts; db-parity test enforces.';

-- ============================================================
-- 6. user_settings.github_token_encrypted — parallel encrypted column
-- ============================================================
--
-- The existing `github_token TEXT` column is plain text. Comments
-- across the codebase implied encryption; security-reviewer caught
-- the drift (SAL-015 logs the correction). Phase 1 lands the
-- encrypted column alongside; Phase 2 (after the read path is
-- migrated) drops the plaintext column. This matches CLAUDE.md's
-- two-PR rule for destructive changes.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS github_token_encrypted BYTEA;

COMMENT ON COLUMN public.user_settings.github_token_encrypted IS
  'AES-256-GCM ciphertext (12-byte IV || 16-byte tag || ciphertext). Replaces the plaintext github_token column once the read path migrates. SAL-015.';

-- ============================================================
-- 7. customers.bounced_at + complained_at + bounce_reason
-- ============================================================
--
-- Set by the webhook handler when a hard bounce / complaint event
-- arrives. The send action checks bounced_at IS NULL before
-- enqueueing — bouncing the same address twice gets the team's
-- domain on Resend's suppression list.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS bounced_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS complained_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_reason   TEXT;

COMMENT ON COLUMN public.customers.bounced_at IS
  'Hard-bounce timestamp from the email provider. Sends to this customer''s email are blocked until the user updates the address (which clears bounced_at).';
COMMENT ON COLUMN public.customers.complained_at IS
  'Spam-complaint timestamp from the email provider. Sends are blocked until cleared by the user.';

-- ============================================================
-- 8. customers_v rebuild — surface bounce columns
-- ============================================================

DROP VIEW IF EXISTS public.customers_v;

CREATE VIEW public.customers_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  c.id,
  c.user_id,
  c.name,
  c.email,
  c.address,
  c.notes,
  CASE WHEN public.can_view_customer_rate(c.id) THEN c.default_rate ELSE NULL END AS default_rate,
  c.payment_terms_days,
  c.show_country_on_invoice,
  c.bounced_at,
  c.complained_at,
  c.bounce_reason,
  c.created_at,
  c.archived,
  c.team_id,
  c.is_sample,
  c.rate_visibility,
  c.rate_editability
FROM public.customers c;
