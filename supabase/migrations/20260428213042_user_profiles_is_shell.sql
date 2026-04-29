-- Shell auth users for historical-data import.
--
-- The Harvest importer (and future imports from Toggl / Clockify /
-- etc.) lets the operator pick a "Create shell account" mapping for
-- ex-collaborators who won't sign in to Shyre. That creates a real
-- auth.users row with a non-deliverable email + random password,
-- so time_entries.user_id can FK to it the same way it does for
-- active users — the existing display / RLS / report paths stay
-- linear, no nullable columns to chase.
--
-- The auth row carries a `shell_account: true` flag in
-- raw_user_meta_data, but that lives on auth.users which is only
-- queryable via the service role. UI surfaces (team detail member
-- list, invite suggestions, member-rate setters) need to filter
-- shell accounts out under regular RLS, so we mirror the bit onto
-- user_profiles where it joins cleanly with team_members.
--
-- Defaults to false: existing rows and any non-import writer keep
-- behaving exactly as before. Idempotent — IF NOT EXISTS in case the
-- column was added manually before this migration ran.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_shell BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_is_shell
  ON public.user_profiles (is_shell)
  WHERE is_shell;
