-- Policy change: drop the agent API's blanket 7-day backdating cap.
--
-- Real-world failure: a 22-entry estimated backfill for Jul 1-15 (built from
-- git history) bounced wholesale as TK400 "invalid time range" — which reads
-- like a malformed request, not a policy refusal.
--
-- The cap never guarded what it claimed. entries:write can only INSERT, so a
-- leaked token cannot rewrite history at any age — it can only fabricate NEW
-- entries, and a fake entry dated yesterday bills exactly like one dated last
-- month. The real controls, kept/strengthened here:
--   1. team_period_locks — closed books refuse backdated writes. The table
--      trigger (trg_time_entries_period_lock_guard) already fired on this
--      INSERT path, but surfaced as check_violation -> 500 "internal". Now
--      pre-checked explicitly -> TK403 with a self-explanatory message (the
--      trigger stays as the race backstop).
--   2. Attribution + audit: agent entries carry started_by_kind='agent' +
--      created_via_token_id and land on the agent-time-review surface.
--   3. A 1-year sanity bound replaces the 7-day cap: it catches wrong-year
--      date bugs, never a legitimate backfill.
-- Also: the four time-range refusals no longer collapse into one generic
-- 'invalid time range' — each names its rule, in both the exception message
-- (forwarded to the caller by the route layer) and the audit detail reason.
-- (SAL-059 caveat: the 'denied' api_log_event rows roll back with the RAISE
-- and never persist — error_logs is the durable refusal record, not
-- integration_events. The reasons are kept here for when that's fixed.)
--
-- Unchanged guards: <=24h per entry, <=5min future skew, same-project overlap
-- refusal, internal -> non-billable, idempotency replay, description quality.
-- Same signature -> CREATE OR REPLACE, anon-only grant preserved (SAL-054).
CREATE OR REPLACE FUNCTION api_log_entry(
  p_token_hash TEXT,
  p_project_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_description TEXT,
  p_agent_label TEXT DEFAULT 'Claude Code',
  p_session_ref TEXT DEFAULT NULL,
  p_idem_key TEXT DEFAULT NULL,
  p_billable BOOLEAN DEFAULT NULL,
  p_category_id UUID DEFAULT NULL
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
  resolved_category UUID;
  v_is_internal BOOLEAN;
  v_lock_end DATE;
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

  -- Time-range validation: one named refusal per rule (a collapsed "invalid
  -- time range" hid WHICH rule refused a 22-entry backfill).
  IF p_end_time <= p_start_time THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'invalid_time_range'));
    RAISE EXCEPTION 'invalid time range: end_time must be after start_time'
      USING ERRCODE = 'TK400';
  END IF;
  IF p_end_time > now() + interval '5 minutes' THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'end_time_in_future'));
    RAISE EXCEPTION 'end_time is in the future (up to 5 minutes of clock skew is tolerated)'
      USING ERRCODE = 'TK400';
  END IF;
  IF p_end_time - p_start_time > interval '24 hours' THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'entry_exceeds_24h'));
    RAISE EXCEPTION 'entry exceeds the 24-hour per-entry maximum; split the work into smaller entries'
      USING ERRCODE = 'TK400';
  END IF;
  -- Sanity bound, not a policy window: a start more than a year back is a
  -- probable date-computation bug (wrong year), never a real backfill.
  IF p_start_time < now() - interval '365 days' THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'start_time_too_old'));
    RAISE EXCEPTION 'start_time is more than a year in the past; refused as a probable date error (check the year)'
      USING ERRCODE = 'TK400';
  END IF;

  clean_desc := NULLIF(btrim(regexp_replace(COALESCE(p_description, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), '');
  IF clean_desc IS NULL OR char_length(clean_desc) < 8 THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', NULL,
      jsonb_build_object('reason', 'description_required'));
    RAISE EXCEPTION 'a meaningful description is required' USING ERRCODE = 'TK400';
  END IF;

  -- Project must be in the token's team; capture its classification for the
  -- billable rule below in the same lookup.
  SELECT p.is_internal INTO v_is_internal
    FROM projects p
    WHERE p.id = p_project_id AND p.team_id = tok.team_id;
  IF NOT FOUND THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', p_project_id,
      jsonb_build_object('reason', 'project_not_in_team'));
    RAISE EXCEPTION 'unknown project' USING ERRCODE = 'TK404';
  END IF;

  -- Backdating policy: no fixed window. Closed books are the control — a
  -- team period lock refuses any entry dated on or before its period_end
  -- (mirrors trg_time_entries_period_lock_guard, which remains the backstop;
  -- this pre-check turns its opaque 500 into a policy 403).
  v_lock_end := team_period_lock_at(tok.team_id);
  IF v_lock_end IS NOT NULL AND (p_start_time)::date <= v_lock_end THEN
    PERFORM api_log_event(tok, 'entries.log', 'denied', p_project_id,
      jsonb_build_object('reason', 'period_locked', 'lock_end', v_lock_end));
    RAISE EXCEPTION 'period locked: the books are closed through %; entries on or before that date are refused', v_lock_end
      USING ERRCODE = 'TK403';
  END IF;

  -- Resolve the category: an explicit arg wins, else the project's default.
  -- Both must belong to the project's effective set (base OR project-scoped
  -- extension). An explicit invalid category is a client error (TK400); a
  -- stale project default is silently dropped so a misconfigured default can
  -- never block logging.
  resolved_category := COALESCE(
    p_category_id,
    (SELECT default_category_id FROM projects WHERE id = p_project_id));
  IF resolved_category IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM categories cat
       WHERE cat.id = resolved_category
         AND (
           cat.category_set_id = (SELECT category_set_id FROM projects WHERE id = p_project_id)
           OR cat.category_set_id IN (
                SELECT cs.id FROM category_sets cs WHERE cs.project_id = p_project_id)
         )
     )
  THEN
    IF p_category_id IS NOT NULL THEN
      PERFORM api_log_event(tok, 'entries.log', 'denied', p_project_id,
        jsonb_build_object('reason', 'category_not_in_project'));
      RAISE EXCEPTION 'category does not belong to the project' USING ERRCODE = 'TK400';
    END IF;
    resolved_category := NULL;  -- stale project default: drop, don't fail
  END IF;

  -- Overlap guard, scoped to the SAME PROJECT: cross-project parallel work is
  -- allowed; a same-project overlap (with a human entry or a running timer on
  -- THIS project) is the real double-log to refuse.
  SELECT array_agg(te.id) INTO overlap_ids FROM time_entries te
    WHERE te.user_id = tok.user_id
      AND te.project_id = p_project_id
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
    category_id,
    started_by_kind, started_by_ref, agent_label, created_via_token_id
  ) VALUES (
    tok.user_id, tok.team_id, p_project_id, clean_desc,
    p_start_time, p_end_time,
    -- Internal projects are never billable (no customer, never invoiced) —
    -- mirrors createTimeEntryAction. Otherwise: explicit flag, else token default.
    CASE WHEN v_is_internal THEN false
         ELSE COALESCE(p_billable, tok.default_billable) END,
    resolved_category,
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
    jsonb_build_object('project_id', p_project_id, 'session_ref', p_session_ref,
      'category_id', resolved_category));
  RETURN to_jsonb(new_row);
END;
$$;
