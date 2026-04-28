-- Credential expiration tracking on user_settings.
--
-- GitHub fine-grained PATs and Atlassian Cloud API tokens both
-- have hard expiration dates (Atlassian caps at 1 year). When a
-- token silently expires, Shyre's only signal today is a 401
-- during a time-entry save → the lookup returns null → the chip
-- never gets a title. Users notice days later, if at all.
--
-- Capture the user-supplied expiry on save and surface a banner
-- when within 14 days of the date so they can renew before
-- saves start failing.
--
-- Storage is just a DATE column per token. Optional — null means
-- "user didn't enter one"; the warning logic only fires when the
-- date is set. The actual security boundary is the existing RLS
-- on user_settings (auth.uid() = user_id only); no extra gating
-- needed for a non-secret date.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS github_token_expires_at   DATE,
  ADD COLUMN IF NOT EXISTS jira_api_token_expires_at DATE;

COMMENT ON COLUMN public.user_settings.github_token_expires_at IS
  'Optional expiration date the user enters when adding their GitHub PAT. Drives the in-app expiry-warning banner; not enforced server-side (the upstream API is the source of truth on whether a token still works).';
COMMENT ON COLUMN public.user_settings.jira_api_token_expires_at IS
  'Optional expiration date the user enters when adding their Jira API token. Atlassian caps at 1 year. Drives the in-app expiry-warning banner.';
