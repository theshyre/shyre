-- Project-scoped category sets.
--
-- Until now `category_sets` could be:
--   - system (is_system=true, team_id=NULL)
--   - team-owned (is_system=false, team_id=<team>)
-- We add a third scope:
--   - project-owned (is_system=false, team_id=NULL, project_id=<project>)
--
-- Project-scoped sets live and die with the project. They're editable
-- by anyone who has access to the project's team, and invisible outside
-- that project's scope. A project.category_set_id can point at any of
-- the three scopes — same column, same shape.

-- 1. Add the scope column and supporting index.
ALTER TABLE category_sets
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_category_sets_project ON category_sets(project_id)
  WHERE project_id IS NOT NULL;

-- 2. Swap the scope CHECK constraint. The original was inline-named by
-- Postgres (likely category_sets_check), which we enumerate + drop to
-- avoid coupling to an auto-generated identifier.
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'category_sets'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%is_system%'
  LOOP
    EXECUTE format('ALTER TABLE category_sets DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE category_sets
  ADD CONSTRAINT category_sets_scope_check CHECK (
    (is_system = true  AND team_id IS NULL     AND project_id IS NULL)
    OR (is_system = false AND team_id IS NOT NULL AND project_id IS NULL)
    OR (is_system = false AND team_id IS NULL     AND project_id IS NOT NULL)
  );

-- 3. Partial unique index for names within a project's set list (mirrors
-- the existing team-scoped UNIQUE(team_id, name)).
CREATE UNIQUE INDEX IF NOT EXISTS category_sets_project_name_uniq
  ON category_sets (project_id, name)
  WHERE project_id IS NOT NULL;

-- 4. RLS — add project-scope read/write alongside system + team policies.
CREATE POLICY "category_sets_project_read" ON public.category_sets FOR SELECT
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = category_sets.project_id
        AND public.user_has_team_access(p.team_id)
    )
  );

CREATE POLICY "category_sets_project_insert" ON public.category_sets FOR INSERT
  WITH CHECK (
    is_system = false
    AND team_id IS NULL
    AND project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id
        AND public.user_has_team_access(p.team_id)
    )
    AND created_by = auth.uid()
  );

CREATE POLICY "category_sets_project_update" ON public.category_sets FOR UPDATE
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = category_sets.project_id
        AND public.user_has_team_access(p.team_id)
    )
  )
  WITH CHECK (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = category_sets.project_id
        AND public.user_has_team_access(p.team_id)
    )
  );

CREATE POLICY "category_sets_project_delete" ON public.category_sets FOR DELETE
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = category_sets.project_id
        AND public.user_has_team_access(p.team_id)
    )
  );

-- 5. Extend `categories` RLS. Existing policies only consider system +
-- team scope. Drop and recreate with a project-scope branch added via
-- OR so categories under a project-scoped set are readable / writable
-- by team members of the owning project.
DROP POLICY IF EXISTS "Read categories via parent set" ON categories;
DROP POLICY IF EXISTS "Write categories on own org sets" ON categories;
DROP POLICY IF EXISTS "Update categories on own org sets" ON categories;
DROP POLICY IF EXISTS "Delete categories on own org sets" ON categories;

CREATE POLICY "categories_read" ON categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND (
          (cs.is_system = true AND auth.uid() IS NOT NULL)
          OR (cs.team_id IS NOT NULL AND public.user_has_team_access(cs.team_id))
          OR (
            cs.project_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM projects p
              WHERE p.id = cs.project_id
                AND public.user_has_team_access(p.team_id)
            )
          )
        )
    )
  );

CREATE POLICY "categories_insert" ON categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND (
          (cs.team_id IS NOT NULL AND public.user_has_team_access(cs.team_id))
          OR (
            cs.project_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM projects p
              WHERE p.id = cs.project_id
                AND public.user_has_team_access(p.team_id)
            )
          )
        )
    )
  );

CREATE POLICY "categories_update" ON categories FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND (
          (cs.team_id IS NOT NULL AND public.user_has_team_access(cs.team_id))
          OR (
            cs.project_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM projects p
              WHERE p.id = cs.project_id
                AND public.user_has_team_access(p.team_id)
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND (
          (cs.team_id IS NOT NULL AND public.user_has_team_access(cs.team_id))
          OR (
            cs.project_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM projects p
              WHERE p.id = cs.project_id
                AND public.user_has_team_access(p.team_id)
            )
          )
        )
    )
  );

CREATE POLICY "categories_delete" ON categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND (
          (cs.team_id IS NOT NULL AND public.user_has_team_access(cs.team_id))
          OR (
            cs.project_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM projects p
              WHERE p.id = cs.project_id
                AND public.user_has_team_access(p.team_id)
            )
          )
        )
    )
  );

COMMENT ON COLUMN category_sets.project_id IS
  'Set to a projects.id when the set is project-scoped (tied to one project, not reusable elsewhere). Mutually exclusive with team_id per category_sets_scope_check.';
