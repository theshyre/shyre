-- Phase 2a (2/3): rate visibility helper functions.
--
-- Four SECURITY DEFINER helpers, one per rate-bearing table, that
-- return whether the calling user may view the rate on a given row.
-- They encode the visibility hierarchy defined in the rate-columns
-- migration:
--   'owner'       — user_team_role = 'owner'
--   'admins'      — user_team_role ∈ ('owner', 'admin')
--   'self'        — above + the member themselves (team_members only)
--   'all_members' — everyone on the team
-- Plus, for customer-linked objects (projects, customers), a cross-team
-- bypass: a `customer_permissions.permission_level = 'admin'` entry for
-- the caller always grants rate visibility regardless of their team
-- role. This keeps the existing customer-sharing model consistent — a
-- customer admin already has admin-level access to the customer's
-- resources.
--
-- These helpers are what the column-masked views (3/3) call from a
-- CASE expression to decide whether to expose or NULL the rate column.
-- They are not wired into any RLS policy — row visibility is already
-- governed by the base table policies. The helpers only gate the
-- column value.

CREATE OR REPLACE FUNCTION public.can_view_team_rate(p_team_id UUID)
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
          (ts.rate_visibility = 'admins'
             AND user_team_role(p_team_id) = 'admin')
          OR (ts.rate_visibility = 'all_members'
             AND user_team_role(p_team_id) IN ('admin', 'member'))
        )
    );
$$;

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
        user_team_role(p.team_id) = 'owner'
        OR (p.rate_visibility = 'admins'
           AND user_team_role(p.team_id) = 'admin')
        OR (p.rate_visibility = 'all_members'
           AND user_team_role(p.team_id) IN ('admin', 'member'))
        OR (p.customer_id IS NOT NULL
           AND user_customer_permission(p.customer_id) = 'admin')
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
        user_team_role(c.team_id) = 'owner'
        OR (c.rate_visibility = 'admins'
           AND user_team_role(c.team_id) = 'admin')
        OR (c.rate_visibility = 'all_members'
           AND user_team_role(c.team_id) IN ('admin', 'member'))
      )
  )
  OR user_customer_permission(p_customer_id) = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.can_view_member_rate(p_membership_id UUID)
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
        OR (tm.rate_visibility IN ('admins', 'self', 'all_members')
           AND user_team_role(tm.team_id) = 'admin')
        OR (tm.rate_visibility IN ('self', 'all_members')
           AND tm.user_id = auth.uid())
        OR (tm.rate_visibility = 'all_members'
           AND user_team_role(tm.team_id) = 'member')
      )
  );
$$;
