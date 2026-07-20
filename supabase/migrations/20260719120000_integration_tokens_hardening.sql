-- SAL-054 + SAL-055: integration-token hardening (2026-07-19 audit).
--
-- SAL-054 — token_hash IS a usable credential. The six api_* SECURITY
-- DEFINER RPCs authenticate on p_token_hash, and the RLS SELECT policy
-- lets a team owner/admin read every column of every member token —
-- including token_hash. A team admin could read a member's hash and call
-- api_log_entry with it, forging time entries attributed to that member;
-- any hash-at-rest leak (pg_dump, log capture) would be a live
-- credential. Fix: column-level SELECT privileges. Postgres subtlety: a
-- column REVOKE cannot subtract from a table-level grant, so revoke the
-- table-level SELECT and re-grant the explicit non-secret column list
-- (exactly what /settings/integrations reads).
--
-- Also revoke EXECUTE on the api_* RPCs from `authenticated`: the route
-- and MCP layers call them through a bare anon server client, so a
-- browser session has no legitimate path to them.
--
-- SAL-055 — the revoke-only trigger enumerated the columns it locked and
-- omitted window_started_at / window_count / last_used_at. The UPDATE
-- policy passes for the token owner and team admins, so a token owner
-- could zero window_count via PostgREST and fully bypass the 120/min
-- rate limit (SAL-025 recurrence), or rewrite last_used_at forensics.
-- Fix: default-DENY row-image comparison (SAL-034 expenses pattern) —
-- columns added in the future are locked automatically.

-- ─── SAL-054: column-level SELECT ────────────────────────────────────────

REVOKE SELECT ON public.integration_tokens FROM authenticated, anon;
GRANT SELECT (
  id,
  user_id,
  team_id,
  name,
  token_prefix,
  scopes,
  default_billable,
  created_at,
  expires_at,
  last_used_at,
  revoked_at
) ON public.integration_tokens TO authenticated;
-- (supabase_auth_admin keeps its explicit table-level SELECT, DELETE for
-- referential-integrity checks — SAL-050 forward rule.)

REVOKE EXECUTE ON FUNCTION public.api_whoami(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.api_list_projects(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.api_get_timer(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.api_start_timer(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.api_stop_timer(TEXT, TEXT, BOOLEAN) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.api_log_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM authenticated;

-- ─── SAL-055: default-DENY immutability trigger ──────────────────────────

CREATE OR REPLACE FUNCTION tg_integration_tokens_revoke_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Default-DENY: the ONLY client-visible change is revoked_at. Compare
  -- full row images minus that one column so any column added later is
  -- locked without editing this trigger. The WHEN clause on the trigger
  -- restricts this to app roles; the definer RPCs (window_*/last_used_at
  -- bookkeeping) run as the function owner and bypass it.
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at') THEN
    RAISE EXCEPTION 'integration tokens are immutable; create a new token instead'
      USING ERRCODE = 'TK001';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'token is already revoked' USING ERRCODE = 'TK001';
  END IF;
  RETURN NEW;
END;
$$;
