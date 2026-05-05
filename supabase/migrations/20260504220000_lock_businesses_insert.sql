-- Tighten the businesses INSERT policy so that authenticated users
-- cannot directly INSERT arbitrary rows. The legitimate insert paths
-- (handle_new_user trigger; create_team RPC) are SECURITY DEFINER
-- and run as `postgres`, which bypasses RLS — so dropping the
-- authenticated INSERT path doesn't break either.
--
-- Audit context: the prior policy was
--   WITH CHECK (auth.uid() IS NOT NULL)
-- which let any signed-in user spam the table with rows that aren't
-- linked to any team they own. Defense-in-depth: the legitimate
-- creation paths route through SECURITY DEFINER, so this policy can
-- safely refuse direct inserts.

DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;

-- Refuse direct INSERT from PostgREST. The SECURITY DEFINER paths
-- (`handle_new_user`, `create_team`) bypass RLS entirely — this
-- only blocks authenticated-role inserts.
CREATE POLICY "businesses_no_direct_insert" ON public.businesses
  FOR INSERT
  WITH CHECK (false);

COMMENT ON POLICY "businesses_no_direct_insert" ON public.businesses IS
  'Direct INSERT from authenticated is refused. Legitimate inserts go through SECURITY DEFINER functions (handle_new_user, create_team).';
