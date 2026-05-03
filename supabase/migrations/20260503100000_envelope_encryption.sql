-- Envelope encryption: per-team data keys (DEKs) wrapped by the
-- single instance master key (KEK).
--
-- Phase 1 of the messaging platform shipped with one shared master
-- key encrypting every team's API key directly. Multi-tenant design
-- requires per-team isolation: a leaked DEK only exposes one team's
-- secrets, KEK rotation only re-wraps the DEKs (not every stored
-- secret), and audit / compliance posture improves.
--
-- Pattern:
--
--   EMAIL_KEY_ENCRYPTION_KEY (env)  ──wraps──▶  team_email_config.dek_encrypted
--                                                       │
--                                                       └──encrypts──▶  api_key_encrypted (and any future per-team secrets)
--
-- This migration adds the column. App code (`src/lib/messaging/
-- encryption.ts`) gets new wrap/unwrap + encryptForTeam/
-- decryptForTeam helpers. Existing direct-KEK ciphers continue to
-- decrypt via a legacy fallback inside decryptForTeam — they're
-- migrated forward lazily on the next save (decryptForTeam reads
-- the legacy cipher with KEK; the next encryptForTeam writes a new
-- cipher with the team's DEK). No big-bang backfill required.
--
-- DEKs are 32 random bytes (AES-256). Wrapped DEK ciphertext is the
-- same shape as encrypted secrets: 12-byte IV || 16-byte tag ||
-- ciphertext. Both layers use AES-256-GCM.
--
-- See SAL-018 for the security rationale.

ALTER TABLE public.team_email_config
  ADD COLUMN IF NOT EXISTS dek_encrypted BYTEA;

COMMENT ON COLUMN public.team_email_config.dek_encrypted IS
  'AES-256-GCM ciphertext of this team''s data-encryption key, wrapped by the instance master key (EMAIL_KEY_ENCRYPTION_KEY). Generated lazily on first save by encryptForTeam(). Unwraps via decryptForTeam(). NULL on legacy rows that pre-date envelope encryption — those rows fall through to direct-KEK decryption until the next save.';
