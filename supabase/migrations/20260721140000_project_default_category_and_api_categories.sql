-- Feature: per-project default category + categories on the integration API.
--
-- Agent-logged entries (Claude Code hooks -> api_log_entry) previously landed
-- with NO category, because api_log_entry never set category_id and the hook
-- has no way to know a team's categories. This:
--   1. adds projects.default_category_id (the per-project default),
--   2. embeds each project's EFFECTIVE categories (base set + project-scoped
--      extensions) + the default in api_list_projects, so an agent can see and
--      choose categories in one call, and
--   3. teaches api_log_entry to accept an optional category and otherwise fall
--      back to the project's default (soft — the entry stays editable).
--
-- "Effective set" mirrors validate_time_entry_category (20260415200000): a
-- category is valid for a project if it is in the project's base
-- category_set_id OR in a category_sets row whose project_id = the project.

-- ─── 1. Per-project default category ────────────────────────────────────────
-- ON DELETE SET NULL: deleting the category (or its set, which cascades to the
-- categories) clears the default rather than blocking the delete.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS default_category_id UUID
    REFERENCES categories(id) ON DELETE SET NULL;

-- ─── 2. list_projects embeds categories + the default ───────────────────────
-- Same signature (CREATE OR REPLACE, no grant churn). STRUCTURALLY RATE-FREE
-- column allow-list preserved; the two new keys are project context, no rate.
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
      'default_category_id', p.default_category_id,
      'categories', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', cat.id,
            'name', cat.name,
            'color', cat.color,
            'is_default', cat.id = p.default_category_id
          ) ORDER BY cat.sort_order, cat.name)
        FROM categories cat
        WHERE cat.category_set_id = p.category_set_id
           OR cat.category_set_id IN (
                SELECT cs.id FROM category_sets cs WHERE cs.project_id = p.id
              )
      ), '[]'::jsonb)
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

-- ─── 3. log_entry accepts a category, falls back to the project default ──────
-- Adding an argument changes the signature (Postgres would otherwise create a
-- second overload), so DROP the 9-arg then CREATE the 10-arg and re-establish
-- grants. anon-only, PUBLIC revoked (SAL-054: the route/MCP layers use the
-- anon server client; a browser session must have no path to these RPCs).
DROP FUNCTION IF EXISTS api_log_entry(
  TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN);

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
    category_id,
    started_by_kind, started_by_ref, agent_label, created_via_token_id
  ) VALUES (
    tok.user_id, tok.team_id, p_project_id, clean_desc,
    p_start_time, p_end_time,
    COALESCE(p_billable, tok.default_billable),
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

REVOKE ALL ON FUNCTION api_log_entry(
  TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_log_entry(
  TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID)
  TO anon;

-- ─── 4. Expose default_category_id on projects_v (frozen-column rule) ────────
-- loadProject() reads projects_v with select("*"); a view's column list is
-- frozen at creation, so the new column must be re-projected here or the
-- project-settings editor reads nothing (the customers_v/logo_url incident).
CREATE OR REPLACE VIEW public.projects_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  p.id,
  p.customer_id,
  p.user_id,
  p.name,
  p.description,
  CASE WHEN public.can_view_project_rate(p.id) THEN p.hourly_rate ELSE NULL END AS hourly_rate,
  p.budget_hours,
  p.github_repo,
  p.status,
  p.created_at,
  p.team_id,
  p.category_set_id,
  p.require_timestamps,
  p.is_sample,
  p.rate_visibility,
  p.rate_editability,
  p.jira_project_key,
  p.invoice_code,
  p.time_entries_visibility,
  p.is_internal,
  p.default_billable,
  p.parent_project_id,
  p.budget_hours_per_period,
  CASE
    WHEN public.can_view_project_rate(p.id)
      THEN p.budget_dollars_per_period
    ELSE NULL
  END AS budget_dollars_per_period,
  p.budget_period,
  p.budget_carryover,
  p.budget_alert_threshold_pct,
  p.projected_end_date,
  p.closed_at,
  p.closed_by_user_id,
  -- Appended here (20260721140000): per-project default category.
  p.default_category_id
FROM public.projects p;
