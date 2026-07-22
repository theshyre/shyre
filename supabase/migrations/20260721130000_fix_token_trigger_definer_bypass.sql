-- SAL-058: the integration-token immutability trigger fired on the RPCs'
-- OWN rate-limit bookkeeping, returning HTTP 500 on every real-token API call.
--
-- SAL-055 (20260719120000) rewrote tg_integration_tokens_revoke_only() as a
-- default-DENY row-image comparison: any change to a column other than
-- revoked_at raises TK001. Its safety valve is the trigger's WHEN clause,
-- meant to fire ONLY for direct app-role PostgREST writes and to let the
-- SECURITY DEFINER RPCs' window_started_at / window_count / last_used_at
-- bookkeeping through (api_resolve_token UPDATEs those on every call).
--
-- The bug: that WHEN clause keyed on current_setting('role') — the
-- REQUEST-level GUC PostgREST sets to 'anon' for the integration surface's
-- bare-anon client. But SECURITY DEFINER changes current_user, NOT the role
-- GUC: inside api_resolve_token the GUC is still 'anon', so the trigger
-- FIRED on the RPC's own rate-window UPDATE, raised TK001, and TK001 is
-- deliberately un-mapped in the route layer (ERRCODE_MAP) -> HTTP 500.
--   * a REAL token passes resolution, reaches the UPDATE, trips the trigger -> 500
--   * a FABRICATED token bails at the "invalid token" TK401 BEFORE the UPDATE -> 401
-- which is why SAL-051's fabricated-token probes never caught it (no real
-- token had been exercised end-to-end until 2026-07-21). SAL-055's resolution
-- note "Definer RPCs still bypass via the existing role-gated WHEN clause"
-- states exactly the assumption this corrects.
--
-- Fix: key the WHEN clause on current_user (the EFFECTIVE role) instead of
-- the role GUC. Inside a SECURITY DEFINER function current_user is the
-- function OWNER (never an app role), so the RPC bookkeeping bypasses; a
-- direct PostgREST write still runs as 'authenticated'/'anon' and stays
-- locked. SAL-055's rate-limit-tamper protection is fully preserved — only
-- the definer's own writes are exempted, which is what was intended.
--
-- tg_time_entries_attribution_lock carries the IDENTICAL WHEN idiom. It never
-- 500'd (its function only guards attribution columns and no definer RPC
-- updates those), but the guard is latently wrong the same way — fixed here
-- preventively so a future default-DENY change or an attribution-touching RPC
-- can't regress into the same 500.

-- ─── the actively-broken one (integration_tokens) ───────────────────────────
DROP TRIGGER IF EXISTS integration_tokens_revoke_only ON integration_tokens;
CREATE TRIGGER integration_tokens_revoke_only
  BEFORE UPDATE ON integration_tokens
  FOR EACH ROW
  WHEN (current_user::text IN ('authenticated', 'anon'))
  EXECUTE FUNCTION tg_integration_tokens_revoke_only();

-- ─── the latently-wrong sibling (time_entries) ──────────────────────────────
DROP TRIGGER IF EXISTS time_entries_attribution_lock ON time_entries;
CREATE TRIGGER time_entries_attribution_lock
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  WHEN (current_user::text IN ('authenticated', 'anon'))
  EXECUTE FUNCTION tg_time_entries_attribution_lock();
