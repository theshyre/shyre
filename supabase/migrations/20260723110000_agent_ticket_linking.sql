-- Make agent-API time logging work end-to-end: expose the (effective) Jira
-- key on the agent read path, and auto-link tickets on the agent write path.
--
-- Background: #152 (20260723100000) made jira_project_key inheritable in the
-- APP read path + attach.ts, but (1) never exposed it on api_list_projects and
-- (2) api_log_entry runs no link detection at all — ticket detection
-- (src/lib/tickets/detect.ts) is TS, called only from UI saves + harvest
-- import. So an agent entry with "AE-709" got no linked_ticket_*.
--
-- Both fixes are computed INSIDE the existing RPCs from data they already have
-- -> same signatures -> CREATE OR REPLACE, ACLs preserved (SAL-054). No new
-- scopes, routes, service, or MCP surface. Every backdating / inheritance /
-- SAL-061 invariant from 20260723100000 is reproduced verbatim below.

-- 1. api_list_projects — emit the EFFECTIVE jira_project_key (own or inherited
--    from the same-team parent), completing the #152 inheritance on the agent
--    read path. github_repo stays own-only (repo->project must be unambiguous).
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
      'customer_name', c.name,
      'github_repo', p.github_repo,
      'jira_project_key', COALESCE(p.jira_project_key, par.jira_project_key),
      'default_category_id', eff.effective_default_id,
      'categories', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', cat.id,
            'name', cat.name,
            'color', cat.color,
            'is_default', COALESCE(cat.id = eff.effective_default_id, false)
          ) ORDER BY cat.sort_order, cat.name)
        FROM categories cat
        WHERE cat.category_set_id = eff.effective_set_id
           OR cat.category_set_id IN (
                SELECT cs.id FROM category_sets cs
                WHERE cs.project_id = p.id
                   -- Parent extension sets only when inheriting, and only
                   -- from the SAME-TEAM parent (par.id is NULL cross-team).
                   OR (p.category_set_id IS NULL
                       AND cs.project_id = par.id)
              )
      ), '[]'::jsonb)
    ) ORDER BY p.name), '[]'::jsonb)
    INTO result
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    -- SAL-061: same-team-scoped parent JOIN (see validate function).
    LEFT JOIN projects par
      ON par.id = p.parent_project_id AND par.team_id = p.team_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(p.category_set_id, par.category_set_id) AS effective_set_id,
        CASE WHEN p.category_set_id IS NOT NULL
             THEN p.default_category_id
             ELSE COALESCE(p.default_category_id, par.default_category_id)
        END AS effective_default_id
    ) eff
    WHERE p.team_id = tok.team_id
      AND p.status IN ('active', 'paused');
  PERFORM api_log_event(tok, 'projects.list', 'ok');
  RETURN result;
END;
$$;

-- 2. api_log_entry — auto-link the first ticket reference in the description
--    (structural link only: provider/key/url; title is fetched lazily by the
--    existing link-refresh chip, the state ticketUrl() is built for). All
--    20260723100000 behavior is unchanged; only the project lookup captures
--    two more fields, a detection block runs, and the INSERT sets the link.
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
  v_own_set UUID;
  v_parent_id UUID;
  v_eff_set UUID;
  v_eff_default UUID;
  v_lock_end DATE;
  -- Ticket auto-linking (this migration):
  v_eff_jira_key TEXT;
  v_github_repo TEXT;
  v_jira_base_url TEXT;
  v_link_provider TEXT := NULL;
  v_link_key TEXT := NULL;
  v_link_url TEXT := NULL;
  v_m TEXT[];
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

  -- Project must be in the token's team. One lookup captures the billable
  -- classification, the effective category vocabulary (own, or inherited LIVE
  -- from the parent — inherit.ts), AND the effective jira key + own github_repo
  -- for ticket auto-linking below.
  -- SAL-061: v_parent_id := the SAME-TEAM parent id (par.id is NULL when the
  -- parent is cross-team via the scoped LEFT JOIN), so a token can never
  -- inherit/log against a foreign team's vocabulary.
  SELECT p.is_internal, p.category_set_id, par.id,
         COALESCE(p.category_set_id, par.category_set_id),
         CASE WHEN p.category_set_id IS NOT NULL
              THEN p.default_category_id
              ELSE COALESCE(p.default_category_id, par.default_category_id)
         END,
         COALESCE(p.jira_project_key, par.jira_project_key),
         p.github_repo
    INTO v_is_internal, v_own_set, v_parent_id, v_eff_set, v_eff_default,
         v_eff_jira_key, v_github_repo
    FROM projects p
    LEFT JOIN projects par
      ON par.id = p.parent_project_id AND par.team_id = p.team_id
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

  -- Resolve the category: an explicit arg wins, else the EFFECTIVE default
  -- (own, else inherited). It must belong to the effective vocabulary: the
  -- effective base set, an extension set owned by this project, or — when
  -- inheriting — an extension set owned by the parent. An explicit invalid
  -- category is a client error (TK400); a stale default is silently dropped.
  resolved_category := COALESCE(p_category_id, v_eff_default);
  IF resolved_category IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM categories cat
       WHERE cat.id = resolved_category
         AND (
           cat.category_set_id = v_eff_set
           OR cat.category_set_id IN (
                SELECT cs.id FROM category_sets cs
                WHERE cs.project_id = p_project_id
                   OR (v_own_set IS NULL AND cs.project_id = v_parent_id)
              )
         )
     )
  THEN
    IF p_category_id IS NOT NULL THEN
      PERFORM api_log_event(tok, 'entries.log', 'denied', p_project_id,
        jsonb_build_object('reason', 'category_not_in_project'));
      RAISE EXCEPTION 'category does not belong to the project' USING ERRCODE = 'TK400';
    END IF;
    resolved_category := NULL;  -- stale default: drop, don't fail
  END IF;

  -- Overlap guard, scoped to the SAME PROJECT: cross-project parallel work is
  -- allowed; a same-project overlap (human or running timer on THIS project)
  -- is the real double-log to refuse.
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

  -- Ticket auto-linking. The app-side detector (src/lib/tickets/detect.ts)
  -- runs only on UI saves, so agent entries never linked. Detect the first
  -- ref here — structural link only; linked_ticket_title stays NULL and the
  -- existing link-refresh chip fills it (the "not yet looked up" state
  -- ticketUrl() targets). Precedence mirrors detect.ts: GitHub long-form ->
  -- Jira -> GitHub short. THIS REGEX IS A SECOND ENCODING OF detect.ts —
  -- keep the two in sync (pinned by project-default-category-migration.test).

  -- (a) GitHub long form: owner/repo#N (self-describing, low false-positive).
  v_m := regexp_match(clean_desc,
    '([A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*)#([0-9]+)');
  IF v_m IS NOT NULL THEN
    v_link_provider := 'github';
    v_link_key := v_m[1] || '#' || v_m[2];
    v_link_url := 'https://github.com/' || v_m[1] || '/issues/' || v_m[2];
  END IF;

  -- (b) Jira: <KEY>-N, but ONLY when <KEY> equals the project's EFFECTIVE
  -- jira_project_key (own or inherited). Deliberately STRICTER than the app
  -- (which links any XXX-N): agent descriptions are machine-generated and
  -- full of UTF-8 / ISO-8601 / SHA-1 false positives, so scope to the
  -- configured key. URL from the token owner's user_settings.jira_base_url.
  IF v_link_provider IS NULL
     AND v_eff_jira_key IS NOT NULL
     AND v_eff_jira_key ~ '^[A-Z][A-Z0-9_]+$'
  THEN
    v_m := regexp_match(clean_desc, '\m' || v_eff_jira_key || '-([0-9]+)\M');
    IF v_m IS NOT NULL THEN
      v_link_provider := 'jira';
      v_link_key := v_eff_jira_key || '-' || v_m[1];
      SELECT jira_base_url INTO v_jira_base_url
        FROM user_settings WHERE user_id = tok.user_id;
      IF v_jira_base_url IS NOT NULL AND btrim(v_jira_base_url) <> '' THEN
        v_link_url := rtrim(v_jira_base_url, '/') || '/browse/' || v_link_key;
      END IF;
    END IF;
  END IF;

  -- (c) GitHub short form: #N -> the project's OWN github_repo (github_repo is
  -- deliberately not inherited; a child under an umbrella has none).
  IF v_link_provider IS NULL
     AND v_github_repo IS NOT NULL AND btrim(v_github_repo) <> ''
  THEN
    v_m := regexp_match(clean_desc, '(^|[^A-Za-z0-9_/])#([0-9]+)');
    IF v_m IS NOT NULL THEN
      v_link_provider := 'github';
      v_link_key := v_github_repo || '#' || v_m[2];
      v_link_url := 'https://github.com/' || v_github_repo || '/issues/' || v_m[2];
    END IF;
  END IF;

  INSERT INTO time_entries (
    user_id, team_id, project_id, description, start_time, end_time, billable,
    category_id,
    linked_ticket_provider, linked_ticket_key, linked_ticket_url,
    started_by_kind, started_by_ref, agent_label, created_via_token_id
  ) VALUES (
    tok.user_id, tok.team_id, p_project_id, clean_desc,
    p_start_time, p_end_time,
    -- Internal projects are never billable (no customer, never invoiced) —
    -- mirrors createTimeEntryAction. Otherwise: explicit flag, else token default.
    CASE WHEN v_is_internal THEN false
         ELSE COALESCE(p_billable, tok.default_billable) END,
    resolved_category,
    v_link_provider, v_link_key, v_link_url,
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
      'category_id', resolved_category, 'linked_ticket_key', v_link_key));
  RETURN to_jsonb(new_row);
END;
$$;

-- Belt-and-suspenders: CREATE OR REPLACE preserves the ACL, but restate the
-- SAL-054 anon-only grant so the posture is explicit in the migration that
-- touches the function.
REVOKE ALL ON FUNCTION api_log_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_log_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) TO anon;
