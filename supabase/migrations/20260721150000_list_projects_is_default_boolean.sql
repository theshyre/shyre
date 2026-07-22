-- Polish on 20260721140000: api_list_projects returned `is_default: null` for
-- every category when a project had no default_category_id, because
-- `cat.id = NULL` is NULL in SQL (and only non-matching rows are `false` once a
-- default IS set). On an API contract meant for external consumers, is_default
-- should be a clean boolean — COALESCE it to false. Same signature, so this is
-- a straight CREATE OR REPLACE (no grant churn).
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
            'is_default', COALESCE(cat.id = p.default_category_id, false)
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
