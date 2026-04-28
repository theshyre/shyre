-- Ticket linking — Jira + GitHub.
--
-- Lets a user paste a ticket key into a time-entry description and
-- have Shyre auto-resolve the title from the source system. The
-- description stays as the user typed it; the resolved title /
-- URL / provider land in dedicated columns so a later rename in
-- Jira doesn't silently mutate the description.
--
-- Three slices, all additive:
--
--   1. user_settings: Jira credentials. github_token already lives
--      here as a per-user PAT; Jira mirrors that shape.
--
--   2. time_entries: linked_ticket_provider / key / url / title /
--      refreshed_at. Coexists with the legacy github_issue INT
--      column — readers of github_issue (projects detail page,
--      time-entry export) keep working, and new entries can carry
--      the richer link.
--
--   3. projects: jira_project_key for short-ref resolution. The
--      existing projects.github_repo plays the same role on the
--      GitHub side, so a user logging time on a project that has
--      a default repo / Jira project can type just "#123" and
--      Shyre fills in the rest.
--
-- A CHECK constraint on the provider keeps the column honest; a
-- partial index on (linked_ticket_provider, linked_ticket_key)
-- speeds up "find every entry that links to this ticket" lookups.

-- ============================================================
-- 1. user_settings: Jira creds
-- ============================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS jira_base_url   TEXT,
  ADD COLUMN IF NOT EXISTS jira_email      TEXT,
  ADD COLUMN IF NOT EXISTS jira_api_token  TEXT;

COMMENT ON COLUMN public.user_settings.jira_api_token IS
  'Jira API token (Atlassian). Treated as a secret like github_token — never logged, only returned to the owning user in their profile.';

-- ============================================================
-- 2. time_entries: linked-ticket columns
-- ============================================================

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS linked_ticket_provider     TEXT
    CHECK (linked_ticket_provider IS NULL OR linked_ticket_provider IN ('jira', 'github')),
  ADD COLUMN IF NOT EXISTS linked_ticket_key          TEXT,
  ADD COLUMN IF NOT EXISTS linked_ticket_url          TEXT,
  ADD COLUMN IF NOT EXISTS linked_ticket_title        TEXT,
  ADD COLUMN IF NOT EXISTS linked_ticket_refreshed_at TIMESTAMPTZ;

-- Provider + key together are the canonical reference. Don't unique-
-- constrain — multiple time entries on the same ticket is the norm.
CREATE INDEX IF NOT EXISTS idx_time_entries_linked_ticket
  ON public.time_entries (linked_ticket_provider, linked_ticket_key)
  WHERE linked_ticket_provider IS NOT NULL;

COMMENT ON COLUMN public.time_entries.linked_ticket_key IS
  'Provider-native key. For jira: "PROJ-123". For github: "owner/repo#123" (always qualified — short refs are resolved against projects.github_repo before being stored).';

-- ============================================================
-- 3. projects: Jira short-ref resolution
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS jira_project_key TEXT;

COMMENT ON COLUMN public.projects.jira_project_key IS
  'Default Jira project key for this Shyre project. When a user types a short ref like "123", Shyre prepends this key to form "<key>-123". Uppercase by convention.';
