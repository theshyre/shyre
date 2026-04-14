-- The original SELECT policy on system_admins self-joined the same table,
-- which triggers "infinite recursion detected in policy for relation
-- system_admins" in modern Postgres. That broke requireSystemAdmin()'s
-- lookup for EVERY sysadmin, kicking every /admin/* page back to /.
--
-- Fix: reuse the existing SECURITY DEFINER helper public.is_system_admin(),
-- which runs with elevated privileges and skips RLS on its own query,
-- so there's no recursion.

DROP POLICY IF EXISTS "System admins can view system_admins" ON public.system_admins;

CREATE POLICY "System admins can view system_admins"
  ON public.system_admins FOR SELECT
  USING (public.is_system_admin());
