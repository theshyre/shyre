-- Phase 2d: delegation flag + meta-permission helper.
--
-- Who can change rate_visibility / rate_editability values on an object?
-- By default: only the team owner. Owners may optionally delegate this
-- meta-permission to team admins via team_settings.admins_can_set_rate_permissions.
--
-- The flag itself is owner-only to toggle (server action enforces),
-- which is why the helper hard-codes 'owner' as the only role that
-- always qualifies. "More roles" extensibility lives at the server-
-- action layer (or a future migration extending the CHECK constraint).
--
-- Note: this is META-permission. Setting the ACTUAL rate value is gated
-- separately by can_set_team_rate / can_set_project_rate / etc. (Phase
-- 2c). These can diverge — an admin might have rate_editability delegated
-- to them (can change rate values) without having permission delegation
-- (can't change who else can change rates).

ALTER TABLE public.team_settings
  ADD COLUMN admins_can_set_rate_permissions BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_set_rate_permissions(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    user_team_role(p_team_id) = 'owner'
    OR (
      user_team_role(p_team_id) = 'admin'
      AND EXISTS (
        SELECT 1 FROM team_settings ts
        WHERE ts.team_id = p_team_id
          AND ts.admins_can_set_rate_permissions = true
      )
    );
$$;
