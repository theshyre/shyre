-- Agent entry mutation API (GET / list / PATCH / soft-DELETE).
--
-- The v1 surface was POST-only, so an agent couldn't fix its own mistakes
-- (trim a duration, backfill a category, remove a stray entry). This adds four
-- SECURITY DEFINER RPCs behind two NEW token scopes.
--
-- Guardrails (Marcus's calls, 2026-07-23):
--   * PATCH/DELETE touch ONLY agent-created rows (started_by_kind='agent')
--     owned by the token's user — a leaked token can never rewrite or delete
--     human-entered time.
--   * DELETE is SOFT (deleted_at = now(); recoverable via /trash + Undo),
--     restricted to agent-created + UNINVOICED + unlocked rows, under a new
--     `entries:delete` scope. This deliberately reverses the SAL-051 "no delete
--     scope" decision, bounded by those guards + soft-delete + audit.
--   * GET/list are read-only under a new `entries:read` scope, scoped to the
--     token's own team.
-- Not editable: project (no cross-project moves), attribution (immutable
-- trigger), and updating a description does NOT re-run ticket detection
-- (re-log or use the UI refresh — keeps api_log_entry untouched).

-- ============================================================
-- 1. Widen the scope allow-list: + entries:read, + entries:delete
-- ============================================================
-- CHECK + DEFAULT are widened via a NEW migration (prod applies only pending
-- files by version, so editing the foundation file would NOT reach prod).
ALTER TABLE integration_tokens DROP CONSTRAINT integration_tokens_scopes_allowed;
ALTER TABLE integration_tokens ADD CONSTRAINT integration_tokens_scopes_allowed CHECK (
  scopes <@ ARRAY['context:read','timer:read','timer:write','entries:read','entries:write','entries:delete']::text[]
  AND array_length(scopes, 1) >= 1
);
ALTER TABLE integration_tokens
  ALTER COLUMN scopes SET DEFAULT ARRAY['context:read','timer:read','timer:write','entries:read','entries:write','entries:delete'];

-- Backfill: grant existing tokens the two new capabilities so they work
-- without regeneration (no scope picker exists — every token gets every
-- scope). Appends only the missing scopes, order-stable. Runs as the migration
-- role, so the revoke-only trigger (WHEN current_user IN authenticated/anon)
-- does not fire.
UPDATE integration_tokens
  SET scopes = scopes || ARRAY(
    SELECT s FROM unnest(ARRAY['entries:read','entries:delete']) s
    WHERE s <> ALL (scopes))
  WHERE NOT (scopes @> ARRAY['entries:read','entries:delete']::text[]);

-- ============================================================
-- 2. api_get_entry — GET /api/v1/entries/:id (entries:read)
-- ============================================================
CREATE OR REPLACE FUNCTION api_get_entry(p_token_hash TEXT, p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  result JSONB;
BEGIN
  tok := api_resolve_token(p_token_hash, 'entries:read');
  SELECT to_jsonb(te) INTO result
    FROM time_entries te
    WHERE te.id = p_entry_id
      AND te.user_id = tok.user_id
      AND te.team_id = tok.team_id
      AND te.deleted_at IS NULL;
  IF result IS NULL THEN
    PERFORM api_log_event(tok, 'entries.get', 'denied', p_entry_id,
      jsonb_build_object('reason', 'not_found'));
    RAISE EXCEPTION 'unknown entry' USING ERRCODE = 'TK404';
  END IF;
  PERFORM api_log_event(tok, 'entries.get', 'ok', p_entry_id);
  RETURN result;
END;
$$;

-- ============================================================
-- 3. api_list_entries — GET /api/v1/entries (entries:read)
-- ============================================================
-- The caller's own entries, newest first, optionally filtered by project /
-- since. started_by_kind is included so the agent knows which rows it may
-- mutate (agent-created only).
CREATE OR REPLACE FUNCTION api_list_entries(
  p_token_hash TEXT,
  p_project_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  v_limit INTEGER;
  result JSONB;
BEGIN
  tok := api_resolve_token(p_token_hash, 'entries:read');
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  SELECT COALESCE(jsonb_agg(row_json ORDER BY start_time DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT te.start_time,
             jsonb_build_object(
               'id', te.id,
               'project_id', te.project_id,
               'description', te.description,
               'start_time', te.start_time,
               'end_time', te.end_time,
               'duration_min', te.duration_min,
               'billable', te.billable,
               'category_id', te.category_id,
               'started_by_kind', te.started_by_kind,
               'linked_ticket_provider', te.linked_ticket_provider,
               'linked_ticket_key', te.linked_ticket_key,
               'invoiced', te.invoiced
             ) AS row_json
        FROM time_entries te
        WHERE te.user_id = tok.user_id
          AND te.team_id = tok.team_id
          AND te.deleted_at IS NULL
          AND (p_project_id IS NULL OR te.project_id = p_project_id)
          AND (p_since IS NULL OR te.start_time >= p_since)
        ORDER BY te.start_time DESC
        LIMIT v_limit
    ) sub;
  PERFORM api_log_event(tok, 'entries.list', 'ok', NULL,
    jsonb_build_object('project_id', p_project_id, 'limit', v_limit));
  RETURN result;
END;
$$;

-- ============================================================
-- 4. api_update_entry — PATCH /api/v1/entries/:id (entries:write)
-- ============================================================
-- Partial update of an AGENT-created, uninvoiced, unlocked entry. NULL params
-- mean "leave unchanged" (COALESCE with the current value). Re-validates the
-- time range, the effective category vocabulary, the internal->non-billable
-- rule, and the same-project overlap guard against the NEW window.
CREATE OR REPLACE FUNCTION api_update_entry(
  p_token_hash TEXT,
  p_entry_id UUID,
  p_start_time TIMESTAMPTZ DEFAULT NULL,
  p_end_time TIMESTAMPTZ DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_billable BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  entry time_entries;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_desc TEXT;
  v_billable BOOLEAN;
  v_category UUID;
  v_is_internal BOOLEAN;
  v_own_set UUID;
  v_parent_id UUID;
  v_eff_set UUID;
  v_lock_end DATE;
  overlap_ids UUID[];
  new_row time_entries;
BEGIN
  tok := api_resolve_token(p_token_hash, 'entries:write');
  PERFORM pg_advisory_xact_lock(hashtext('timer:' || tok.user_id::text));

  -- Reject an empty patch outright (no-op UPDATE + misleading 'ok' event).
  IF p_start_time IS NULL AND p_end_time IS NULL AND p_description IS NULL
     AND p_category_id IS NULL AND p_billable IS NULL THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'no_fields'));
    RAISE EXCEPTION 'no fields to update' USING ERRCODE = 'TK400';
  END IF;

  SELECT * INTO entry FROM time_entries te
    WHERE te.id = p_entry_id
      AND te.user_id = tok.user_id
      AND te.team_id = tok.team_id
      AND te.deleted_at IS NULL;
  IF NOT FOUND THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'not_found'));
    RAISE EXCEPTION 'unknown entry' USING ERRCODE = 'TK404';
  END IF;

  -- Agent-created only: never touch human-entered time (Marcus's guardrail).
  IF entry.started_by_kind IS DISTINCT FROM 'agent' THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'not_agent_created'));
    RAISE EXCEPTION 'only agent-created entries can be modified via the API'
      USING ERRCODE = 'TK403';
  END IF;

  -- Invoiced entries are immutable (the invoice-lock trigger would also
  -- refuse; pre-check gives a clean 409).
  IF entry.invoiced IS TRUE OR entry.invoice_id IS NOT NULL THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'invoiced'));
    RAISE EXCEPTION 'entry is invoiced; void the invoice first' USING ERRCODE = 'TK409';
  END IF;

  v_start := COALESCE(p_start_time, entry.start_time);
  v_end := COALESCE(p_end_time, entry.end_time);

  -- Description: only when supplied; must clean to >= 8 chars.
  IF p_description IS NOT NULL THEN
    v_desc := NULLIF(btrim(regexp_replace(p_description, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), '');
    IF v_desc IS NULL OR char_length(v_desc) < 8 THEN
      PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
        jsonb_build_object('reason', 'description_required'));
      RAISE EXCEPTION 'a meaningful description is required' USING ERRCODE = 'TK400';
    END IF;
  ELSE
    v_desc := entry.description;
  END IF;

  -- Time-range re-validation. Bounds tied to a specific timestamp only fire
  -- when that timestamp actually changed (editing duration on an old entry
  -- must not trip the 365-day create-sanity bound).
  IF v_end <= v_start THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'invalid_time_range'));
    RAISE EXCEPTION 'invalid time range: end_time must be after start_time' USING ERRCODE = 'TK400';
  END IF;
  IF p_end_time IS NOT NULL AND v_end > now() + interval '5 minutes' THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'end_time_in_future'));
    RAISE EXCEPTION 'end_time is in the future (up to 5 minutes of clock skew is tolerated)' USING ERRCODE = 'TK400';
  END IF;
  IF v_end - v_start > interval '24 hours' THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'entry_exceeds_24h'));
    RAISE EXCEPTION 'entry exceeds the 24-hour per-entry maximum; split the work into smaller entries' USING ERRCODE = 'TK400';
  END IF;
  IF p_start_time IS NOT NULL AND v_start < now() - interval '365 days' THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'start_time_too_old'));
    RAISE EXCEPTION 'start_time is more than a year in the past; refused as a probable date error (check the year)' USING ERRCODE = 'TK400';
  END IF;

  -- Period lock: neither the OLD nor the NEW date may fall in a closed period
  -- (can't edit a locked row; can't move one into a locked period).
  v_lock_end := team_period_lock_at(tok.team_id);
  IF v_lock_end IS NOT NULL
     AND ((entry.start_time)::date <= v_lock_end OR (v_start)::date <= v_lock_end)
  THEN
    PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
      jsonb_build_object('reason', 'period_locked', 'lock_end', v_lock_end));
    RAISE EXCEPTION 'period locked: the books are closed through %; this entry cannot be edited', v_lock_end
      USING ERRCODE = 'TK403';
  END IF;

  -- Category: only when supplied; validate against the entry project's
  -- EFFECTIVE vocabulary (own or same-team-parent inherited — inherit.ts /
  -- SAL-061). Explicit invalid -> TK400.
  IF p_category_id IS NOT NULL THEN
    SELECT p.is_internal, p.category_set_id, par.id,
           COALESCE(p.category_set_id, par.category_set_id)
      INTO v_is_internal, v_own_set, v_parent_id, v_eff_set
      FROM projects p
      LEFT JOIN projects par
        ON par.id = p.parent_project_id AND par.team_id = p.team_id
      WHERE p.id = entry.project_id;
    IF NOT EXISTS (
      SELECT 1 FROM categories cat
      WHERE cat.id = p_category_id
        AND (
          cat.category_set_id = v_eff_set
          OR cat.category_set_id IN (
               SELECT cs.id FROM category_sets cs
               WHERE cs.project_id = entry.project_id
                  OR (v_own_set IS NULL AND cs.project_id = v_parent_id)
             )
        )
    ) THEN
      PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
        jsonb_build_object('reason', 'category_not_in_project'));
      RAISE EXCEPTION 'category does not belong to the project' USING ERRCODE = 'TK400';
    END IF;
    v_category := p_category_id;
  ELSE
    v_category := entry.category_id;
  END IF;

  -- Billable: internal projects are never billable; else explicit-or-current.
  SELECT p.is_internal INTO v_is_internal FROM projects p WHERE p.id = entry.project_id;
  v_billable := CASE WHEN v_is_internal THEN false
                     ELSE COALESCE(p_billable, entry.billable) END;

  -- Same-project overlap against the NEW window, excluding this entry.
  IF p_start_time IS NOT NULL OR p_end_time IS NOT NULL THEN
    SELECT array_agg(te.id) INTO overlap_ids FROM time_entries te
      WHERE te.user_id = tok.user_id
        AND te.project_id = entry.project_id
        AND te.id <> p_entry_id
        AND te.deleted_at IS NULL
        AND te.start_time < v_end
        AND COALESCE(te.end_time, now()) > v_start;
    IF overlap_ids IS NOT NULL THEN
      PERFORM api_log_event(tok, 'entries.update', 'denied', p_entry_id,
        jsonb_build_object('reason', 'overlaps_existing', 'entry_ids', to_jsonb(overlap_ids)));
      RAISE EXCEPTION 'overlaps existing entries' USING ERRCODE = 'TK409';
    END IF;
  END IF;

  -- No updated_at column on time_entries: the stamp-actor trigger records the
  -- mutator (updated_by_user_id), and duration_min is GENERATED (recomputes
  -- from the new start/end). Setting a phantom column would 42703 → 500.
  UPDATE time_entries SET
    start_time = v_start,
    end_time = v_end,
    description = v_desc,
    category_id = v_category,
    billable = v_billable
    WHERE id = p_entry_id
    RETURNING * INTO new_row;

  PERFORM api_log_event(tok, 'entries.update', 'ok', p_entry_id,
    jsonb_build_object(
      'changed', (
        ARRAY(SELECT k FROM (VALUES
          ('start_time', (p_start_time IS NOT NULL)),
          ('end_time', (p_end_time IS NOT NULL)),
          ('description', (p_description IS NOT NULL)),
          ('category_id', (p_category_id IS NOT NULL)),
          ('billable', (p_billable IS NOT NULL))
        ) AS t(k, changed) WHERE changed)
      )));
  RETURN to_jsonb(new_row);
END;
$$;

-- ============================================================
-- 5. api_delete_entry — DELETE /api/v1/entries/:id (entries:delete)
-- ============================================================
-- Soft-delete (deleted_at = now()); recoverable via /trash. Agent-created +
-- uninvoiced + unlocked only.
CREATE OR REPLACE FUNCTION api_delete_entry(p_token_hash TEXT, p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok integration_tokens;
  entry time_entries;
  v_lock_end DATE;
BEGIN
  tok := api_resolve_token(p_token_hash, 'entries:delete');
  PERFORM pg_advisory_xact_lock(hashtext('timer:' || tok.user_id::text));

  SELECT * INTO entry FROM time_entries te
    WHERE te.id = p_entry_id
      AND te.user_id = tok.user_id
      AND te.team_id = tok.team_id
      AND te.deleted_at IS NULL;
  IF NOT FOUND THEN
    PERFORM api_log_event(tok, 'entries.delete', 'denied', p_entry_id,
      jsonb_build_object('reason', 'not_found'));
    RAISE EXCEPTION 'unknown entry' USING ERRCODE = 'TK404';
  END IF;

  IF entry.started_by_kind IS DISTINCT FROM 'agent' THEN
    PERFORM api_log_event(tok, 'entries.delete', 'denied', p_entry_id,
      jsonb_build_object('reason', 'not_agent_created'));
    RAISE EXCEPTION 'only agent-created entries can be deleted via the API' USING ERRCODE = 'TK403';
  END IF;

  IF entry.invoiced IS TRUE OR entry.invoice_id IS NOT NULL THEN
    PERFORM api_log_event(tok, 'entries.delete', 'denied', p_entry_id,
      jsonb_build_object('reason', 'invoiced'));
    RAISE EXCEPTION 'entry is invoiced; void the invoice first' USING ERRCODE = 'TK409';
  END IF;

  v_lock_end := team_period_lock_at(tok.team_id);
  IF v_lock_end IS NOT NULL AND (entry.start_time)::date <= v_lock_end THEN
    PERFORM api_log_event(tok, 'entries.delete', 'denied', p_entry_id,
      jsonb_build_object('reason', 'period_locked', 'lock_end', v_lock_end));
    RAISE EXCEPTION 'period locked: the books are closed through %; this entry cannot be deleted', v_lock_end
      USING ERRCODE = 'TK403';
  END IF;

  UPDATE time_entries SET deleted_at = now() WHERE id = p_entry_id;

  PERFORM api_log_event(tok, 'entries.delete', 'ok', p_entry_id);
  RETURN jsonb_build_object('id', p_entry_id, 'deleted', true);
END;
$$;

-- ============================================================
-- 6. Grants — anon-only (SAL-054), same as the sibling api_* RPCs.
-- ============================================================
REVOKE ALL ON FUNCTION api_get_entry(TEXT, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_get_entry(TEXT, UUID) TO anon;
REVOKE ALL ON FUNCTION api_list_entries(TEXT, UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_list_entries(TEXT, UUID, INTEGER, TIMESTAMPTZ) TO anon;
REVOKE ALL ON FUNCTION api_update_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, BOOLEAN) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_update_entry(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID, BOOLEAN) TO anon;
REVOKE ALL ON FUNCTION api_delete_entry(TEXT, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION api_delete_entry(TEXT, UUID) TO anon;
