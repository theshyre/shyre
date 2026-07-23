-- LIVE parent→child setting inheritance for nested projects (one level).
--
-- A child project whose own column is NULL resolves the setting from its
-- parent at READ/VALIDATE time — the umbrella stays the source of truth
-- (a later umbrella change propagates), and a child's own value is an
-- override. Mirrors src/lib/projects/inherit.ts — the two layers move
-- together.
--
-- v1 inherited: the category vocabulary (base set + the parent's
-- project-scoped extension sets + default category — travels as a UNIT:
-- a child with its OWN base set inherits none of it) and, app-side,
-- jira_project_key for ticket detection. Deliberately NOT inherited:
-- billing fields (per-deliverable by design: fixed-bid children under an
-- hourly umbrella), and github_repo on the agent API (the agent's
-- repo→project mapping must resolve to ONE project).
--
-- Why: proposal-convert creates children with NULL category columns; the
-- AVDR deliverables were uncategorizable and their AE-### descriptions
-- never linked (2026-07-23). Convert deliberately keeps copying nothing.
--
-- Three definer redefinitions, same signatures -> CREATE OR REPLACE,
-- ACLs preserved (api_log_entry stays anon-only per SAL-054; restated at
-- the tail belt-and-suspenders). SAL-061: every parent JOIN is
-- same-team-scoped in the JOIN condition so inheritance can never resolve
-- a cross-team parent's vocabulary (latent until a project-move feature).

-- 1. validate_time_entry_category — the app-write gate on
--    time_entries.category_id learns the inherited vocabulary.
CREATE OR REPLACE FUNCTION public.validate_time_entry_category()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  project_set_id UUID;
  project_parent_id UUID;
  effective_set_id UUID;
  cat_set_id     UUID;
  cat_set_project_id UUID;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- SAL-061: the parent JOIN is same-team-scoped in the JOIN condition
  -- itself, not left to the parent-invariant trigger. A cross-team parent
  -- (only reachable if a future "move project" feature relocates one)
  -- resolves to NULL here — the child keeps its own vocabulary and no
  -- foreign team's category names leak through inheritance.
  -- project_parent_id := the SAME-TEAM parent id (par.id is NULL when the
  -- parent is cross-team via the scoped LEFT JOIN), so the extension-set
  -- branch below can never match a foreign parent's set.
  SELECT p.category_set_id, par.id,
         COALESCE(p.category_set_id, par.category_set_id)
    INTO project_set_id, project_parent_id, effective_set_id
    FROM projects p
    LEFT JOIN projects par
      ON par.id = p.parent_project_id AND par.team_id = p.team_id
    WHERE p.id = NEW.project_id;

  SELECT cs.id, cs.project_id
    INTO cat_set_id, cat_set_project_id
    FROM categories c
    JOIN category_sets cs ON cs.id = c.category_set_id
    WHERE c.id = NEW.category_id;

  -- Category in the project's EFFECTIVE base set (own, or the parent's
  -- when the child has none): OK.
  IF effective_set_id IS NOT NULL AND effective_set_id = cat_set_id THEN
    RETURN NEW;
  END IF;

  -- Category in a project-scoped extension set owned by this project —
  -- or, when the child is inheriting (no own base set), owned by its
  -- SAME-TEAM parent (project_parent_id is NULL above when the parent is
  -- cross-team, so this branch can't reach a foreign parent's extension).
  IF cat_set_project_id IS NOT NULL
     AND (cat_set_project_id = NEW.project_id
          OR (project_set_id IS NULL
              AND cat_set_project_id = project_parent_id))
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Category does not belong to the project''s base or extension category set';
END;
$$ LANGUAGE plpgsql;

-- 2. api_list_projects — agents see the child's EFFECTIVE vocabulary
--    (the AVDR deliverables return the umbrella's categories instead of
--    []). github_repo intentionally remains the OWN value only.
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

-- 3. api_log_entry — category resolution/validation against the
--    EFFECTIVE vocabulary. Everything else is UNCHANGED from
--    20260722150000 (backdating policy): no fixed backdating window,
--    1-year sanity bound, period-lock TK403 pre-check, named refusals,
--    same-project overlap, internal -> non-billable, idempotency.
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

  -- Project must be in the token's team. One lookup captures the
  -- billable classification AND the effective category vocabulary
  -- (own, or inherited LIVE from the parent when the child has no base
  -- set of its own — inherit.ts model).
  -- SAL-061: v_parent_id := the SAME-TEAM parent id (par.id is NULL when
  -- the parent is cross-team via the scoped LEFT JOIN), so a token can
  -- never inherit/log against a foreign team's category vocabulary.
  SELECT p.is_internal, p.category_set_id, par.id,
         COALESCE(p.category_set_id, par.category_set_id),
         CASE WHEN p.category_set_id IS NOT NULL
              THEN p.default_category_id
              ELSE COALESCE(p.default_category_id, par.default_category_id)
         END
    INTO v_is_internal, v_own_set, v_parent_id, v_eff_set, v_eff_default
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

  -- Resolve the category: an explicit arg wins, else the EFFECTIVE
  -- default (own, else inherited). It must belong to the effective
  -- vocabulary: the effective base set, an extension set owned by this
  -- project, or — when inheriting — an extension set owned by the
  -- parent. An explicit invalid category is a client error (TK400); a
  -- stale default is silently dropped so a misconfigured default can
  -- never block logging.
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

-- Belt-and-suspenders: CREATE OR REPLACE preserves the ACL, but restate
-- the SAL-054 anon-only grant in the migration that touches the function
-- so the posture is explicit rather than implied by CREATE OR REPLACE
-- semantics.
REVOKE ALL ON FUNCTION api_log_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_log_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) TO anon;
