-- External-application integration surface — P1 foundation (SAL-051).
--
-- Ships: integration_tokens (per-user, per-team PATs, sha256 at rest),
-- integration_events (append-only API audit log), integration_idempotency
-- (retry dedupe), team_settings.integrations_enabled kill switch (default
-- OFF — default-closed), time_entries agent-attribution columns
-- (multi-stream-timers Option B Phase 1), and the SECURITY DEFINER RPC
-- layer that is the ONLY write/read path for the session-less /api/v1
-- surface. Design: docs/reference/multi-stream-timers.md + the 2026-07-18
-- five-agent integration review.
--
-- Auth-mapping decision: definer RPCs keyed by token hash (verify + act +
-- audit in ONE transaction). Service-role querying was rejected (SAL-002..013
-- lineage: hand-written filters silently fail), JWT minting was rejected
-- (impersonation primitive; project is on the new asymmetric key system).
-- Consequences accepted per the security review: each RPC explicitly stamps
-- actor/team from the TOKEN ROW (never caller input) and explicitly
-- re-checks any guard a role-gated trigger would have skipped.

-- ============================================================
-- 1. Token + audit tables
-- ============================================================

-- The kill switch must exist BEFORE the token policies that reference it.
ALTER TABLE team_settings
  ADD COLUMN IF NOT EXISTS integrations_enabled BOOLEAN NOT NULL DEFAULT false;

-- team_settings_v has a FROZEN column list (the customer-logo-blank
-- incident, PR #34): appending the new column requires CREATE OR REPLACE
-- in the SAME migration or the settings UI reads nothing. Exact prior
-- definition from 20260716130000, + integrations_enabled appended.
CREATE OR REPLACE VIEW public.team_settings_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  ts.team_id,
  ts.business_name,
  ts.business_email,
  ts.business_address,
  ts.business_phone,
  ts.logo_url,
  CASE WHEN public.can_view_team_rate(ts.team_id) THEN ts.default_rate ELSE NULL END AS default_rate,
  ts.invoice_prefix,
  ts.invoice_next_num,
  ts.tax_rate,
  ts.wordmark_primary,
  ts.wordmark_secondary,
  ts.brand_color,
  ts.default_payment_terms_days,
  ts.show_country_on_invoice,
  ts.created_at,
  ts.updated_at,
  ts.rate_visibility,
  ts.rate_editability,
  ts.proposal_prefix,
  ts.proposal_next_num,
  ts.integrations_enabled
FROM public.team_settings ts;


CREATE TABLE IF NOT EXISTS integration_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  token_hash    TEXT NOT NULL UNIQUE,          -- sha256 hex of the raw PAT
  token_prefix  TEXT NOT NULL,                 -- "shyre_pat_ab34cd…" for UI
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['context:read','timer:read','timer:write','entries:write'],
  -- Agent entries land billable or not per an up-front choice at token
  -- creation (solo-consultant review: one decision, not per-entry cleanup).
  default_billable BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mandatory expiry (assume-breach: no immortal tokens). 90d default,
  -- 1y hard max enforced by CHECK.
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  -- Fixed-window rate limit state (per-token, enforced in resolve).
  window_started_at TIMESTAMPTZ,
  window_count  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT integration_tokens_scopes_allowed CHECK (
    scopes <@ ARRAY['context:read','timer:read','timer:write','entries:write']::text[]
    AND array_length(scopes, 1) >= 1
  ),
  CONSTRAINT integration_tokens_expiry_max CHECK (
    expires_at <= created_at + interval '1 year'
  )
);

CREATE INDEX IF NOT EXISTS idx_integration_tokens_user
  ON integration_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_integration_tokens_team
  ON integration_tokens (team_id);

-- SAL-050 forward rule: new FK to auth.users (CASCADE) needs RI grants for
-- GoTrue's role or hard user-deletes 500 again.
GRANT SELECT, DELETE ON integration_tokens TO supabase_auth_admin;

ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;

-- Owner sees + manages their own tokens; team owner/admin sees + revokes
-- every token writing into their team (agency-owner review B4). NOTE the
-- app layer must never select token_hash in list queries (github_token
-- rule) — enforced by a source test, and the hash alone cannot
-- authenticate (the raw is required).
CREATE POLICY integration_tokens_select ON integration_tokens
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = integration_tokens.team_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    )
  );

-- Creation only for yourself, only on a team you belong to, and only when
-- the team kill switch is on (default-closed).
CREATE POLICY integration_tokens_insert ON integration_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = integration_tokens.team_id
        AND tm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM team_settings ts
      WHERE ts.team_id = integration_tokens.team_id
        AND ts.integrations_enabled
    )
  );

-- Updates exist ONLY to revoke (owner or team admin). The trigger below
-- rejects any change beyond stamping revoked_at.
CREATE POLICY integration_tokens_update ON integration_tokens
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = integration_tokens.team_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    )
  );
-- No DELETE policy: tokens are revoked, never deleted (forensics).

CREATE OR REPLACE FUNCTION tg_integration_tokens_revoke_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The ONLY permitted client change is revoked_at NULL -> now-ish.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.token_prefix IS DISTINCT FROM OLD.token_prefix
     OR NEW.scopes IS DISTINCT FROM OLD.scopes
     OR NEW.default_billable IS DISTINCT FROM OLD.default_billable
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'integration tokens are immutable; create a new token instead'
      USING ERRCODE = 'TK001';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'token is already revoked' USING ERRCODE = 'TK001';
  END IF;
  RETURN NEW;
END;
$$;

-- Guard applies to the app roles only; the definer RPCs (postgres) must be
-- able to touch last_used_at / window_* — this mirrors the messaging
-- column-lock role gate, and the RPCs never modify identity columns.
DROP TRIGGER IF EXISTS integration_tokens_revoke_only ON integration_tokens;
CREATE TRIGGER integration_tokens_revoke_only
  BEFORE UPDATE ON integration_tokens
  FOR EACH ROW
  WHEN (current_setting('role', true) IN ('authenticated', 'anon'))
  EXECUTE FUNCTION tg_integration_tokens_revoke_only();

-- Append-only audit log: every API call, success AND failure ("what did the
-- attacker do with it" must be answerable). Only the definer RPCs write.
CREATE TABLE IF NOT EXISTS integration_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_id    UUID REFERENCES integration_tokens(id) ON DELETE SET NULL,
  user_id     UUID NOT NULL,
  team_id     UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok','denied','error')),
  target_id   UUID,
  detail      JSONB
);
CREATE INDEX IF NOT EXISTS idx_integration_events_token
  ON integration_events (token_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_events_team
  ON integration_events (team_id, occurred_at DESC);

ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_events_select ON integration_events
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = integration_events.team_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    )
  );
-- No INSERT/UPDATE/DELETE policies: append happens inside the RPCs.

-- Retry dedupe: one row per (token, idempotency key); repeat requests
-- return the original entry instead of double-logging (solo review #3).
CREATE TABLE IF NOT EXISTS integration_idempotency (
  token_id   UUID NOT NULL REFERENCES integration_tokens(id) ON DELETE CASCADE,
  idem_key   TEXT NOT NULL CHECK (char_length(idem_key) BETWEEN 1 AND 128),
  entry_id   UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, idem_key)
);
ALTER TABLE integration_idempotency ENABLE ROW LEVEL SECURITY;
-- No client policies at all: purely RPC-internal.

-- ============================================================
-- 2. time_entries attribution
-- ============================================================


ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS started_by_kind TEXT NOT NULL DEFAULT 'user'
    CHECK (started_by_kind IN ('user','agent','integration','import')),
  ADD COLUMN IF NOT EXISTS started_by_ref TEXT
    CHECK (started_by_ref IS NULL OR char_length(started_by_ref) <= 256),
  ADD COLUMN IF NOT EXISTS agent_label TEXT
    CHECK (agent_label IS NULL OR char_length(agent_label) <= 64),
  ADD COLUMN IF NOT EXISTS created_via_token_id UUID
    REFERENCES integration_tokens(id) ON DELETE SET NULL;

-- Attribution is provenance: immutable post-insert for app roles (the
-- SAL-024/025 lock pattern). RPCs never update these either.
CREATE OR REPLACE FUNCTION tg_time_entries_attribution_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.started_by_kind IS DISTINCT FROM OLD.started_by_kind
     OR NEW.started_by_ref IS DISTINCT FROM OLD.started_by_ref
     OR NEW.agent_label IS DISTINCT FROM OLD.agent_label
     OR NEW.created_via_token_id IS DISTINCT FROM OLD.created_via_token_id
  THEN
    RAISE EXCEPTION 'time-entry attribution is immutable'
      USING ERRCODE = 'TK002';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS time_entries_attribution_lock ON time_entries;
CREATE TRIGGER time_entries_attribution_lock
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  WHEN (current_setting('role', true) IN ('authenticated', 'anon'))
  EXECUTE FUNCTION tg_time_entries_attribution_lock();

-- ============================================================
-- 3. The RPC layer (the entire session-less API surface)
-- ============================================================

-- Internal: resolve + validate a token hash. Locks the row, enforces
-- revocation/expiry/CURRENT membership/kill switch/scope/rate window,
-- stamps last_used_at. RAISErs use ERRCODE 'TK4xx'-style custom codes the
-- route layer maps to coarse HTTP statuses (401 for all auth shapes — no
-- oracle; 403 scope; 429 rate).
CREATE OR REPLACE FUNCTION api_resolve_token(
  p_token_hash TEXT,
  p_required_scope TEXT
)
RETURNS integration_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  rate_limit_per_min CONSTANT INTEGER := 120;
BEGIN
  SELECT * INTO tok FROM integration_tokens
    WHERE token_hash = p_token_hash
    FOR UPDATE;
  IF NOT FOUND OR tok.revoked_at IS NOT NULL OR tok.expires_at <= now() THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = 'TK401';
  END IF;
  -- Membership is evaluated LIVE — removal from the team dead-ends the
  -- token on the next call (agency-owner review B4).
  IF NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = tok.team_id AND tm.user_id = tok.user_id
  ) THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = 'TK401';
  END IF;
  -- Team kill switch is enforced per-request: flipping it off kills
  -- EXISTING tokens instantly, not just creation (B5).
  IF NOT EXISTS (
    SELECT 1 FROM team_settings ts
    WHERE ts.team_id = tok.team_id AND ts.integrations_enabled
  ) THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = 'TK401';
  END IF;
  IF NOT (p_required_scope = ANY (tok.scopes)) THEN
    RAISE EXCEPTION 'missing scope %', p_required_scope USING ERRCODE = 'TK403';
  END IF;
  -- Fixed 60s rate window, atomic under the row lock.
  IF tok.window_started_at IS NULL OR tok.window_started_at < now() - interval '60 seconds' THEN
    UPDATE integration_tokens
      SET window_started_at = now(), window_count = 1, last_used_at = now()
      WHERE id = tok.id;
  ELSIF tok.window_count >= rate_limit_per_min THEN
    RAISE EXCEPTION 'rate limit exceeded' USING ERRCODE = 'TK429';
  ELSE
    UPDATE integration_tokens
      SET window_count = window_count + 1, last_used_at = now()
      WHERE id = tok.id;
  END IF;
  RETURN tok;
END;
$$;
-- Internal only: callable solely from the sibling definer functions.
REVOKE ALL ON FUNCTION api_resolve_token(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION api_log_event(
  p_token integration_tokens,
  p_action TEXT,
  p_status TEXT,
  p_target UUID DEFAULT NULL,
  p_detail JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO integration_events (token_id, user_id, team_id, action, status, target_id, detail)
  VALUES ((p_token).id, (p_token).user_id, (p_token).team_id, p_action, p_status, p_target, p_detail);
$$;
REVOKE ALL ON FUNCTION api_log_event(integration_tokens, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- Token introspection — GET /api/v1/me
CREATE OR REPLACE FUNCTION api_whoami(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
BEGIN
  tok := api_resolve_token(p_token_hash, 'context:read');
  PERFORM api_log_event(tok, 'me', 'ok');
  RETURN jsonb_build_object(
    'user_id', tok.user_id,
    'display_name', (SELECT display_name FROM user_profiles WHERE user_id = tok.user_id),
    'team_id', tok.team_id,
    'team_name', (SELECT name FROM teams WHERE id = tok.team_id),
    'token_name', tok.name,
    'scopes', to_jsonb(tok.scopes),
    'default_billable', tok.default_billable,
    'expires_at', tok.expires_at
  );
END;
$$;

-- Project/customer context — GET /api/v1/projects. STRUCTURALLY RATE-FREE:
-- the column list is a hard allow-list; no rate column exists in this
-- function's reach (agency-owner review B3).
CREATE OR REPLACE FUNCTION api_list_projects(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  result JSONB;
BEGIN
  tok := api_resolve_token(p_token_hash, 'context:read');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'is_internal', p.is_internal,
      'customer_id', p.customer_id,
      'customer_name', c.name
    ) ORDER BY p.name), '[]'::jsonb)
    INTO result
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.team_id = tok.team_id
      AND p.status IN ('active', 'paused');
  PERFORM api_log_event(tok, 'projects.list', 'ok');
  RETURN result;
END;
$$;

-- Current running entry — GET /api/v1/timer
CREATE OR REPLACE FUNCTION api_get_timer(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  running JSONB;
BEGIN
  tok := api_resolve_token(p_token_hash, 'timer:read');
  SELECT to_jsonb(x) INTO running FROM (
    SELECT te.id, te.project_id, p.name AS project_name, te.description,
           te.start_time, te.started_by_kind, te.agent_label, te.started_by_ref
    FROM time_entries te
    JOIN projects p ON p.id = te.project_id
    WHERE te.user_id = tok.user_id
      AND te.team_id = tok.team_id
      AND te.end_time IS NULL
      AND te.deleted_at IS NULL
    ORDER BY te.start_time DESC
    LIMIT 1
  ) x;
  PERFORM api_log_event(tok, 'timer.get', 'ok');
  RETURN COALESCE(running, 'null'::jsonb);
END;
$$;

-- Start a timer — POST /api/v1/timer/start.
-- INVARIANT (solo review must-have #1): an agent start NEVER displaces a
-- running timer — any running entry for the token's user raises TK409,
-- atomically (the running check + insert share the transaction; the
-- unique claim is the insert-after-locked-check under SERIALIZABLE-safe
-- row locking on the running row's absence via advisory lock on user).
CREATE OR REPLACE FUNCTION api_start_timer(
  p_token_hash TEXT,
  p_project_id UUID,
  p_description TEXT DEFAULT NULL,
  p_agent_label TEXT DEFAULT 'Claude Code',
  p_session_ref TEXT DEFAULT NULL,
  p_idem_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  existing UUID;
  new_row time_entries;
BEGIN
  tok := api_resolve_token(p_token_hash, 'timer:write');

  -- Serialize concurrent starts for this user (double-fire protection —
  -- the SAL-021/037 read-then-write lineage).
  PERFORM pg_advisory_xact_lock(hashtext('timer:' || tok.user_id::text));

  IF p_idem_key IS NOT NULL THEN
    SELECT entry_id INTO existing FROM integration_idempotency
      WHERE token_id = tok.id AND idem_key = p_idem_key;
    IF FOUND THEN
      PERFORM api_log_event(tok, 'timer.start', 'ok', existing,
        jsonb_build_object('idempotent_replay', true));
      RETURN (SELECT to_jsonb(te) FROM time_entries te WHERE te.id = existing);
    END IF;
  END IF;

  -- Project must belong to the token's team — the id proves nothing on
  -- its own (SAL-033).
  IF NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.team_id = tok.team_id
  ) THEN
    PERFORM api_log_event(tok, 'timer.start', 'denied', p_project_id,
      jsonb_build_object('reason', 'project_not_in_team'));
    RAISE EXCEPTION 'unknown project' USING ERRCODE = 'TK404';
  END IF;

  SELECT te.id INTO existing FROM time_entries te
    WHERE te.user_id = tok.user_id AND te.end_time IS NULL AND te.deleted_at IS NULL
    LIMIT 1;
  IF FOUND THEN
    PERFORM api_log_event(tok, 'timer.start', 'denied', existing,
      jsonb_build_object('reason', 'timer_running'));
    RAISE EXCEPTION 'timer already running' USING ERRCODE = 'TK409';
  END IF;

  INSERT INTO time_entries (
    user_id, team_id, project_id, description, start_time, billable,
    started_by_kind, started_by_ref, agent_label, created_via_token_id
  ) VALUES (
    tok.user_id, tok.team_id, p_project_id,
    NULLIF(btrim(regexp_replace(COALESCE(p_description, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), ''),
    now(), tok.default_billable,
    'agent',
    NULLIF(btrim(COALESCE(p_session_ref, '')), ''),
    NULLIF(btrim(regexp_replace(COALESCE(p_agent_label, ''), '[\x00-\x1F]', '', 'g')), ''),
    tok.id
  ) RETURNING * INTO new_row;

  IF p_idem_key IS NOT NULL THEN
    INSERT INTO integration_idempotency (token_id, idem_key, entry_id)
      VALUES (tok.id, p_idem_key, new_row.id);
  END IF;

  PERFORM api_log_event(tok, 'timer.start', 'ok', new_row.id,
    jsonb_build_object('project_id', p_project_id, 'session_ref', p_session_ref));
  RETURN to_jsonb(new_row);
END;
$$;

-- Stop the running timer — POST /api/v1/timer/stop.
-- Default: only stops an agent-started entry (409 otherwise); p_force
-- stops regardless ("stop my timer" is sometimes exactly the ask — the
-- human configured the token).
CREATE OR REPLACE FUNCTION api_stop_timer(
  p_token_hash TEXT,
  p_description TEXT DEFAULT NULL,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  running time_entries;
BEGIN
  tok := api_resolve_token(p_token_hash, 'timer:write');
  PERFORM pg_advisory_xact_lock(hashtext('timer:' || tok.user_id::text));

  SELECT * INTO running FROM time_entries te
    WHERE te.user_id = tok.user_id AND te.end_time IS NULL AND te.deleted_at IS NULL
    ORDER BY te.start_time DESC LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM api_log_event(tok, 'timer.stop', 'denied', NULL,
      jsonb_build_object('reason', 'no_running_timer'));
    RAISE EXCEPTION 'no running timer' USING ERRCODE = 'TK404';
  END IF;
  IF running.started_by_kind <> 'agent' AND NOT p_force THEN
    PERFORM api_log_event(tok, 'timer.stop', 'denied', running.id,
      jsonb_build_object('reason', 'not_started_by_agent'));
    RAISE EXCEPTION 'running timer was not started by an agent' USING ERRCODE = 'TK409';
  END IF;

  UPDATE time_entries SET
      end_time = now(),
      -- An at-stop description upgrade is the ONE mutation allowed: the
      -- agent knows its outcome at stop time (solo review: description
      -- quality decides whether every entry needs editing).
      description = COALESCE(
        NULLIF(btrim(regexp_replace(COALESCE(p_description, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), ''),
        description
      )
    WHERE id = running.id
    RETURNING * INTO running;

  PERFORM api_log_event(tok, 'timer.stop', 'ok', running.id,
    jsonb_build_object('forced', p_force));
  RETURN to_jsonb(running);
END;
$$;

-- Log a completed block — POST /api/v1/entries. THE RECOMMENDED PATH:
-- no orphans, no idle inflation, outcome-quality descriptions.
-- Overlap with ANY of the user's existing entries is refused (same-author
-- double-counting is the rejected Option C).
CREATE OR REPLACE FUNCTION api_log_entry(
  p_token_hash TEXT,
  p_project_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_description TEXT,
  p_agent_label TEXT DEFAULT 'Claude Code',
  p_session_ref TEXT DEFAULT NULL,
  p_idem_key TEXT DEFAULT NULL,
  p_billable BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  existing UUID;
  overlap_ids UUID[];
  clean_desc TEXT;
  new_row time_entries;
BEGIN
  tok := api_resolve_token(p_token_hash, 'entries:write');
  PERFORM pg_advisory_xact_lock(hashtext('timer:' || tok.user_id::text));

  IF p_idem_key IS NOT NULL THEN
    SELECT entry_id INTO existing FROM integration_idempotency
      WHERE token_id = tok.id AND idem_key = p_idem_key;
    IF FOUND THEN
      PERFORM api_log_event(tok, 'entries.log', 'ok', existing,
        jsonb_build_object('idempotent_replay', true));
      RETURN (SELECT to_jsonb(te) FROM time_entries te WHERE te.id = existing);
    END IF;
  END IF;

  IF p_end_time <= p_start_time
     OR p_end_time > now() + interval '5 minutes'
     OR p_end_time - p_start_time > interval '24 hours'
     OR p_start_time < now() - interval '7 days'
  THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'invalid_time_range'));
    RAISE EXCEPTION 'invalid time range' USING ERRCODE = 'TK400';
  END IF;

  clean_desc := NULLIF(btrim(regexp_replace(COALESCE(p_description, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), '');
  IF clean_desc IS NULL OR char_length(clean_desc) < 8 THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'description_required'));
    RAISE EXCEPTION 'a meaningful description is required' USING ERRCODE = 'TK400';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.team_id = tok.team_id
  ) THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', p_project_id,
      jsonb_build_object('reason', 'project_not_in_team'));
    RAISE EXCEPTION 'unknown project' USING ERRCODE = 'TK404';
  END IF;

  SELECT array_agg(te.id) INTO overlap_ids FROM time_entries te
    WHERE te.user_id = tok.user_id
      AND te.deleted_at IS NULL
      AND te.start_time < p_end_time
      AND COALESCE(te.end_time, now()) > p_start_time;
  IF overlap_ids IS NOT NULL THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'overlaps_existing', 'entry_ids', to_jsonb(overlap_ids)));
    RAISE EXCEPTION 'overlaps existing entries' USING ERRCODE = 'TK409';
  END IF;

  INSERT INTO time_entries (
    user_id, team_id, project_id, description, start_time, end_time, billable,
    started_by_kind, started_by_ref, agent_label, created_via_token_id
  ) VALUES (
    tok.user_id, tok.team_id, p_project_id, clean_desc,
    p_start_time, p_end_time,
    COALESCE(p_billable, tok.default_billable),
    'agent',
    NULLIF(btrim(COALESCE(p_session_ref, '')), ''),
    NULLIF(btrim(regexp_replace(COALESCE(p_agent_label, ''), '[\x00-\x1F]', '', 'g')), ''),
    tok.id
  ) RETURNING * INTO new_row;

  IF p_idem_key IS NOT NULL THEN
    INSERT INTO integration_idempotency (token_id, idem_key, entry_id)
      VALUES (tok.id, p_idem_key, new_row.id);
  END IF;

  PERFORM api_log_event(tok, 'entries.log', 'ok', new_row.id,
    jsonb_build_object('project_id', p_project_id, 'session_ref', p_session_ref));
  RETURN to_jsonb(new_row);
END;
$$;

-- The public API functions are callable by the anon role (the route layer
-- uses the anon server client with NO session). Everything they can do is
-- bounded by the token row they resolve.
GRANT EXECUTE ON FUNCTION api_whoami(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api_list_projects(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api_get_timer(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api_start_timer(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api_stop_timer(TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION api_log_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
