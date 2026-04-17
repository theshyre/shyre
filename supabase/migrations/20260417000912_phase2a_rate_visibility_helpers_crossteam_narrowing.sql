-- Phase 2a correction: narrow the cross-team bypass in
-- can_view_project_rate / can_view_customer_rate so same-team admins
-- no longer incorrectly see the rate when rate_visibility='owner'.
--
-- The underlying `user_customer_permission` helper (see migration
-- 20260414210820_fix_user_customer_permission.sql) deliberately returns
-- 'admin' for any caller who is owner OR admin of the customer's
-- primary team — it exists for the customer-sharing model, where a
-- same-team admin is effectively a customer admin. That's correct for
-- customer-row read access, but it's the wrong lens for rate visibility:
-- when rate_visibility='owner', a same-team admin must NOT see the rate.
--
-- Integration tests Phase 2a/can_view_project_rate and /can_view_customer_rate
-- under the 'default owner' case caught this on first run of the new suite.
--
-- Fix: gate the cross-team bypass on `user_team_role(team_id) IS NULL`,
-- meaning "caller is NOT a member of this project's / customer's team."
-- Same-team callers are now strictly governed by their team role + the
-- rate_visibility hierarchy; the customer-permission bypass only applies
-- to external customer admins whose team role on this team is NULL.

CREATE OR REPLACE FUNCTION public.can_view_project_rate(p_project_id UUID)
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
        -- Same-team hierarchy
        user_team_role(p.team_id) = 'owner'
        OR (p.rate_visibility = 'admins'
           AND user_team_role(p.team_id) = 'admin')
        OR (p.rate_visibility = 'all_members'
           AND user_team_role(p.team_id) IN ('admin', 'member'))
        -- Cross-team customer admin: only for callers with no team
        -- membership on the project's team.
        OR (
          p.customer_id IS NOT NULL
          AND user_team_role(p.team_id) IS NULL
          AND user_customer_permission(p.customer_id) = 'admin'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_customer_rate(p_customer_id UUID)
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
        -- Same-team hierarchy
        user_team_role(c.team_id) = 'owner'
        OR (c.rate_visibility = 'admins'
           AND user_team_role(c.team_id) = 'admin')
        OR (c.rate_visibility = 'all_members'
           AND user_team_role(c.team_id) IN ('admin', 'member'))
        -- Cross-team customer admin
        OR (
          user_team_role(c.team_id) IS NULL
          AND user_customer_permission(p_customer_id) = 'admin'
        )
      )
  );
$$;
