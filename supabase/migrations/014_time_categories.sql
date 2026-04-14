-- Time Categories (Phase 2 of Time Home)
--
-- Adds:
-- - category_sets table: templates of categories, either system-wide (NULL org)
--   or org-scoped. Users can clone system sets into their org.
-- - categories table: individual categories (name + color + sort) within a set
-- - projects.category_set_id: optional FK assigning a set to a project
-- - time_entries.category_id: optional FK to a category (validated to belong
--   to the project's assigned set via trigger)
--
-- Backwards compatible: with no category_set_id on a project, categories are
-- invisible to that project's entries — existing data is unaffected.

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE category_sets (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  -- System sets have NULL organization_id; org sets must have one
  CHECK ((is_system = true AND organization_id IS NULL)
      OR (is_system = false AND organization_id IS NOT NULL)),
  UNIQUE (organization_id, name)
);

CREATE TABLE categories (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_set_id UUID REFERENCES category_sets(id) ON DELETE CASCADE NOT NULL,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#6b7280',  -- gray-500 fallback
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (category_set_id, name)
);

ALTER TABLE projects
  ADD COLUMN category_set_id UUID REFERENCES category_sets(id) ON DELETE SET NULL;

ALTER TABLE time_entries
  ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_category_sets_org ON category_sets(organization_id);
CREATE INDEX idx_category_sets_system ON category_sets(is_system) WHERE is_system = true;
CREATE INDEX idx_categories_set ON categories(category_set_id);
CREATE INDEX idx_projects_category_set ON projects(category_set_id);
CREATE INDEX idx_time_entries_category ON time_entries(category_id);

-- ============================================================
-- 3. TRIGGER — enforce category belongs to project's set
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_time_entry_category()
RETURNS TRIGGER AS $$
DECLARE
  project_set_id UUID;
  cat_set_id     UUID;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT category_set_id INTO project_set_id FROM projects WHERE id = NEW.project_id;
  SELECT category_set_id INTO cat_set_id     FROM categories WHERE id = NEW.category_id;

  IF project_set_id IS NULL THEN
    RAISE EXCEPTION 'Cannot assign category: project has no category_set_id';
  END IF;

  IF project_set_id <> cat_set_id THEN
    RAISE EXCEPTION 'Category does not belong to the project''s category set';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_validate_time_entry_category
  BEFORE INSERT OR UPDATE OF category_id, project_id ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_time_entry_category();

-- ============================================================
-- 4. RLS — category_sets
-- ============================================================

ALTER TABLE category_sets ENABLE ROW LEVEL SECURITY;

-- System sets are readable to any authenticated user
CREATE POLICY "Anyone authenticated can read system sets"
  ON category_sets FOR SELECT
  USING (is_system = true AND auth.uid() IS NOT NULL);

-- Org members can read their org's sets
CREATE POLICY "Org members can read their category sets"
  ON category_sets FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND user_has_org_access(organization_id)
  );

-- Org members can insert sets into their org
CREATE POLICY "Org members can create category sets"
  ON category_sets FOR INSERT
  WITH CHECK (
    is_system = false
    AND organization_id IS NOT NULL
    AND user_has_org_access(organization_id)
    AND created_by = auth.uid()
  );

-- Org members can update their org's non-system sets
CREATE POLICY "Org members can update their category sets"
  ON category_sets FOR UPDATE
  USING (
    is_system = false
    AND organization_id IS NOT NULL
    AND user_has_org_access(organization_id)
  )
  WITH CHECK (
    is_system = false
    AND organization_id IS NOT NULL
    AND user_has_org_access(organization_id)
  );

-- Org members can delete their org's non-system sets
CREATE POLICY "Org members can delete their category sets"
  ON category_sets FOR DELETE
  USING (
    is_system = false
    AND organization_id IS NOT NULL
    AND user_has_org_access(organization_id)
  );

-- ============================================================
-- 5. RLS — categories (inherit parent set's permissions)
-- ============================================================

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Select: any set you can read (system or org)
CREATE POLICY "Read categories via parent set"
  ON categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND (
          (cs.is_system = true AND auth.uid() IS NOT NULL)
          OR (cs.organization_id IS NOT NULL AND user_has_org_access(cs.organization_id))
        )
    )
  );

-- Insert/update/delete only on non-system org sets
CREATE POLICY "Write categories on own org sets"
  ON categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND cs.organization_id IS NOT NULL
        AND user_has_org_access(cs.organization_id)
    )
  );

CREATE POLICY "Update categories on own org sets"
  ON categories FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND cs.organization_id IS NOT NULL
        AND user_has_org_access(cs.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND cs.organization_id IS NOT NULL
        AND user_has_org_access(cs.organization_id)
    )
  );

CREATE POLICY "Delete categories on own org sets"
  ON categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM category_sets cs
      WHERE cs.id = categories.category_set_id
        AND cs.is_system = false
        AND cs.organization_id IS NOT NULL
        AND user_has_org_access(cs.organization_id)
    )
  );

-- ============================================================
-- 6. SEED — system category sets
-- ============================================================

DO $$
DECLARE
  eng_id        UUID := gen_random_uuid();
  consulting_id UUID := gen_random_uuid();
  creative_id   UUID := gen_random_uuid();
  legal_id      UUID := gen_random_uuid();
  generic_id    UUID := gen_random_uuid();
BEGIN
  INSERT INTO category_sets (id, organization_id, name, description, is_system) VALUES
    (eng_id,        NULL, 'Software / Engineering', 'Feature work, bugs, reviews, ops for engineering teams', true),
    (consulting_id, NULL, 'Consulting / Advisory', 'Discovery, analysis, advisory deliverables for consulting engagements', true),
    (creative_id,   NULL, 'Creative / Design', 'Concept, design, revisions for creative work', true),
    (legal_id,      NULL, 'Legal / Professional', 'Research, drafting, client calls for legal and professional services', true),
    (generic_id,    NULL, 'Generic', 'Simple defaults — work, meetings, admin', true);

  -- Engineering
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (eng_id, 'Feature',  '#3b82f6', 10),  -- blue-500
    (eng_id, 'Bug fix',  '#ef4444', 20),  -- red-500
    (eng_id, 'Refactor', '#8b5cf6', 30),  -- violet-500
    (eng_id, 'Review',   '#f59e0b', 40),  -- amber-500
    (eng_id, 'Planning', '#10b981', 50),  -- emerald-500
    (eng_id, 'Meetings', '#6366f1', 60),  -- indigo-500
    (eng_id, 'Ops',      '#64748b', 70),  -- slate-500
    (eng_id, 'Admin',    '#9ca3af', 80);  -- gray-400

  -- Consulting
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (consulting_id, 'Discovery',       '#3b82f6', 10),
    (consulting_id, 'Analysis',        '#8b5cf6', 20),
    (consulting_id, 'Recommendations', '#10b981', 30),
    (consulting_id, 'Presentations',   '#f59e0b', 40),
    (consulting_id, 'Meetings',        '#6366f1', 50),
    (consulting_id, 'Admin',           '#9ca3af', 60);

  -- Creative
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (creative_id, 'Concept',       '#ec4899', 10),  -- pink-500
    (creative_id, 'Design',        '#8b5cf6', 20),
    (creative_id, 'Revisions',     '#f59e0b', 30),
    (creative_id, 'Client review', '#3b82f6', 40),
    (creative_id, 'Research',      '#10b981', 50),
    (creative_id, 'Admin',         '#9ca3af', 60);

  -- Legal
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (legal_id, 'Research',     '#8b5cf6', 10),
    (legal_id, 'Drafting',     '#3b82f6', 20),
    (legal_id, 'Client calls', '#10b981', 30),
    (legal_id, 'Filing',       '#f59e0b', 40),
    (legal_id, 'Admin',        '#9ca3af', 50);

  -- Generic
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (generic_id, 'Work',     '#3b82f6', 10),
    (generic_id, 'Meetings', '#6366f1', 20),
    (generic_id, 'Admin',    '#9ca3af', 30),
    (generic_id, 'Break',    '#10b981', 40);
END $$;
