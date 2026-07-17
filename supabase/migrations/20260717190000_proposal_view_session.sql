-- Proposal view-session gate (SAL-045).
--
-- The OTP one-time code now gates VIEWING the proposal, not just signing it.
-- Previously the tokened link alone let anyone who received (or was forwarded)
-- it read the full pricing + scope; the OTP only gated the accept/decline.
--
-- On a successful OTP verify we now mint a random, per-browser session secret
-- (256-bit, base64url), store its sha256 here, and set the raw secret as an
-- httpOnly cookie scoped to /sign. A fresh browser — or a forwarded link on a
-- device that never completed the code — carries no cookie and cannot forge
-- one (the secret only ever leaves the server in the Set-Cookie header), so it
-- is held at the identity-check gate. The code is only ever emailed to the
-- token's signer_email, so possession of the link is not enough to view.
--
-- Additive + nullable: the sign-service reads the token row via `select *` and
-- fail-CLOSES to the gate whenever these are absent/null, so if the app deploys
-- ahead of this migration the sign page simply shows the gate (never a leak).
ALTER TABLE proposal_access_tokens
  ADD COLUMN IF NOT EXISTS view_session_hash text,
  ADD COLUMN IF NOT EXISTS view_session_expires_at timestamptz;

COMMENT ON COLUMN proposal_access_tokens.view_session_hash IS
  'sha256 of the per-browser view-session secret minted on OTP verify (SAL-045). Raw secret lives only in the signer''s httpOnly cookie.';
COMMENT ON COLUMN proposal_access_tokens.view_session_expires_at IS
  'When the current view session lapses; after this the signer must re-verify with a fresh code to view again.';
