-- Phase 2a (1/3): rate model schema columns.
--
-- See docs/reference/rate-and-access-plan.md.
--
-- Adds per-object rate visibility + editability flags and a per-member
-- default rate. Defaults are deliberately tight ('owner') — every rate
-- starts closed to everyone except the team owner, and an explicit
-- owner action (Phase 2d) is required to open it up.
--
-- No app behavior change from this migration alone. The column-masked
-- views and helper functions in the follow-up Phase 2a migrations
-- enforce visibility when app reads go through them.
--
-- Hierarchy on the 3-level enum (projects, customers, team_settings):
--   owner        — owner only
--   admins       — owner + admins
--   all_members  — everyone on the team
--
-- Hierarchy on the 4-level enum (team_members only):
--   owner        — owner only
--   admins       — owner + admins
--   self         — owner + admins + the member themselves
--   all_members  — everyone on the team
--
-- 'self' is distinct because a per-member rate is the member's own
-- number — the owner may want to show it to Carol without showing
-- Carol's rate to the rest of the team.

-- Per-user-on-team default rate (the new layer in the resolution cascade).
ALTER TABLE public.team_members
  ADD COLUMN default_rate NUMERIC(10,2),
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'self', 'all_members')),
  ADD COLUMN rate_editability TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_editability IN ('owner', 'admins', 'self', 'all_members'));

ALTER TABLE public.projects
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'all_members')),
  ADD COLUMN rate_editability TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_editability IN ('owner', 'admins', 'all_members'));

ALTER TABLE public.customers
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'all_members')),
  ADD COLUMN rate_editability TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_editability IN ('owner', 'admins', 'all_members'));

ALTER TABLE public.team_settings
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'all_members')),
  ADD COLUMN rate_editability TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_editability IN ('owner', 'admins', 'all_members'));
