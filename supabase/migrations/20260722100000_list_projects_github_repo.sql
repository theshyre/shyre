-- Expose projects.github_repo on api_list_projects so an integration/agent can
-- deterministically narrow the team's projects to the ones tied to the repo it
-- is working in (its `git remote origin`), instead of matching on name against
-- an instruction. Key enabler for the monorepo / multiple-projects-per-repo
-- case: the agent filters candidates by github_repo == this remote, then a
-- per-repo convention only has to say which sub-path maps to which candidate.
-- Same signature -> plain CREATE OR REPLACE (grants preserved). github_repo is
-- non-sensitive project context; the column allow-list stays structurally
-- rate-free.
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
