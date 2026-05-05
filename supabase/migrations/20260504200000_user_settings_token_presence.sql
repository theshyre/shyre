-- Generated boolean columns mirroring "is the token set?" so the
-- credential-expiry scan can answer "should I show this row" without
-- ever SELECT-ing the secret bytes.
--
-- RLS still scopes user_settings to the caller's own row, so the
-- cross-user blast radius was already zero. This is defense-in-depth
-- for a future error-capture surface that might snapshot row data —
-- the secret never leaves Postgres for `scanCredentials()`.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS has_github_token BOOLEAN
    GENERATED ALWAYS AS (github_token IS NOT NULL) STORED;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS has_jira_api_token BOOLEAN
    GENERATED ALWAYS AS (jira_api_token IS NOT NULL) STORED;

COMMENT ON COLUMN public.user_settings.has_github_token IS
  'Generated mirror of (github_token IS NOT NULL). Used by scanCredentials so list queries do not read the plaintext token.';
COMMENT ON COLUMN public.user_settings.has_jira_api_token IS
  'Generated mirror of (jira_api_token IS NOT NULL). Used by scanCredentials so list queries do not read the plaintext token.';
