-- Credential expiration tracking — Vercel + Resend.
--
-- Earlier work (migration 20260428211454) added DATE-typed expiry
-- columns on user_settings for GitHub + Jira tokens. The two
-- newer credentials (Vercel API token, Resend API key) didn't get
-- the same treatment when they shipped, so the centralized
-- credential scanner has nothing to read for those — meaning the
-- in-app reminder banner is silent on the credentials most likely
-- to bite the system admin.
--
-- Same shape as the existing columns: nullable DATE (calendar-day
-- granularity is enough for a "rotate by" reminder), no default,
-- legacy rows leave them NULL.

ALTER TABLE public.instance_deploy_config
  ADD COLUMN IF NOT EXISTS api_token_expires_at DATE;

COMMENT ON COLUMN public.instance_deploy_config.api_token_expires_at IS
  'Optional rotate-by date for the Vercel API token. The credential scanner reads it to surface T-30 / T-14 / T-7 banners on the dashboard. Auto-filled to today + 365d when the user saves a token without picking a date.';

ALTER TABLE public.team_email_config
  ADD COLUMN IF NOT EXISTS api_key_expires_at DATE;

COMMENT ON COLUMN public.team_email_config.api_key_expires_at IS
  'Optional rotate-by date for the Resend API key. Resend keys do not expire on their own; this is a self-imposed rotation reminder. Auto-filled to today + 365d when the user saves a new key without picking a date.';
