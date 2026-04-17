-- Phase 2c (1/2): rate editability helper functions.
--
-- Mirrors the can_view_X helpers from Phase 2a but checks
-- rate_editability (not rate_visibility). Used by rate-setter server
-- actions (2c) and by guardrails on existing update actions that might
-- receive a rate field from the form. A caller without edit permission
-- gets rejected at the server-action layer before any UPDATE reaches
-- the DB.
--
-- Semantics (same hierarchy as visibility):
--   'owner'       — only team owner can set
--   'admins'      — owner + admins
--   'self'        — above + the member themselves (team_members only)
--   'all_members' — everyone on the team
--
-- Cross-team bypass (projects / customers only): a genuine cross-team
-- customer admin (user_team_role IS NULL on this team, but
-- user_customer_permission = 'admin') can set the rate. Same narrowing
-- applied to the view helpers per the Phase 2a correction — same-team
-- admins must not bypass via the customer-permission path.

CREATE OR REPLACE FUNCTION public.can_set_team_rate(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    user_team_role(p_team_id) = 'owner'
    OR EXISTS (
      SELECT 1 FROM team_settings ts
      WHERE ts.team_id = p_team_id
        AND (
          (ts.rate_editability = 'admins'
             AND user_team_role(p_team_id) = 'admin')
          OR (ts.rate_editability = 'all_members'
             AND user_team_role(p_team_id) IN ('admin', 'member'))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_set_project_rate(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND (
        user_team_role(p.team_id) = 'owner'
        OR (p.rate_editability = 'admins'
           AND user_team_role(p.team_id) = 'admin')
        OR (p.rate_editability = 'all_members'
           AND user_team_role(p.team_id) IN ('admin', 'member'))
        OR (
          p.customer_id IS NOT NULL
          AND user_team_role(p.team_id) IS NULL
          AND user_customer_permission(p.customer_id) = 'admin'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_set_customer_rate(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = p_customer_id
      AND (
        user_team_role(c.team_id) = 'owner'
        OR (c.rate_editability = 'admins'
           AND user_team_role(c.team_id) = 'admin')
        OR (c.rate_editability = 'all_members'
           AND user_team_role(c.team_id) IN ('admin', 'member'))
        OR (
          user_team_role(c.team_id) IS NULL
          AND user_customer_permission(p_customer_id) = 'admin'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_set_member_rate(p_membership_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.id = p_membership_id
      AND (
        user_team_role(tm.team_id) = 'owner'
        OR (tm.rate_editability IN ('admins', 'self', 'all_members')
           AND user_team_role(tm.team_id) = 'admin')
        OR (tm.rate_editability IN ('self', 'all_members')
           AND tm.user_id = auth.uid())
        OR (tm.rate_editability = 'all_members'
           AND user_team_role(tm.team_id) = 'member')
      )
  );
$$;
