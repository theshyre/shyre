-- Project-scoped categories are an EXTENSION of the project's base set,
-- not a replacement. Previously a project with a project-scoped set
-- pointed `projects.category_set_id` at the project set and lost the
-- built-in one. Now the project keeps its base (system or team) set,
-- and any `category_sets` row with `project_id = project.id` contributes
-- additional categories on top.
--
-- This migration relaxes validate_time_entry_category so a time entry's
-- category can belong to either:
--   - the project's base category_set, OR
--   - a project-scoped extension set (category_sets.project_id = project.id)

CREATE OR REPLACE FUNCTION public.validate_time_entry_category()
RETURNS TRIGGER AS $$
DECLARE
  project_set_id UUID;
  cat_set_id     UUID;
  cat_set_project_id UUID;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT category_set_id INTO project_set_id
    FROM projects WHERE id = NEW.project_id;

  SELECT cs.id, cs.project_id
    INTO cat_set_id, cat_set_project_id
    FROM categories c
    JOIN category_sets cs ON cs.id = c.category_set_id
    WHERE c.id = NEW.category_id;

  -- Category in the project's base set: OK.
  IF project_set_id IS NOT NULL AND project_set_id = cat_set_id THEN
    RETURN NEW;
  END IF;

  -- Category in a project-scoped extension set owned by this project: OK.
  IF cat_set_project_id IS NOT NULL AND cat_set_project_id = NEW.project_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Category does not belong to the project''s base or extension category set';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
