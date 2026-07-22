-- Bug: api_log_entry's overlap guard refused a new agent entry if it overlapped
-- ANY of the user's entries across ALL projects (no project filter). Two
-- consequences, both silent (the hook swallows the 409):
--   1. Parallel agent work on Client A (9:00-9:40) and Client B (9:10-9:50)
--      collides -> the second is dropped. But cross-project concurrency is the
--      whole point (agent-overlap.ts / multi-stream-timers.md), and the
--      invoice-review overlap detector IS already project-scoped — the write
--      guard disagreed with it.
--   2. A left-open human timer (occupying [start, now()]) suppressed EVERY
--      agent entry that day, on every project.
-- Fix: scope the overlap check to the SAME project (te.project_id =
-- p_project_id), matching detectAgentOverlaps. Same-project agent-vs-human (or
-- agent-vs-agent) overlap is still refused — that's the real double-log guard;
-- cross-project parallel work now coexists. Same signature -> CREATE OR REPLACE,
-- anon-only grant preserved. (Same-project agent-vs-agent parallel sessions
-- still collide because both compress to session-start; that's the separate
-- window-basis redesign, not this fix.)
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
