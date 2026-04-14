-- Time Templates (Phase 4)
--
-- Saved (project + description + category + billable) combos for one-click
-- timer starts. Scoped to organization + creating user. Similar to categories,
-- but lighter: no separate template_sets — just a flat list of templates.

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE time_templates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  billable        BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, organization_id, name)
);

CREATE INDEX idx_time_templates_user ON time_templates(user_id);
CREATE INDEX idx_time_templates_org ON time_templates(organization_id);
CREATE INDEX idx_time_templates_last_used ON time_templates(user_id, last_used_at DESC NULLS LAST);

-- ============================================================
-- 2. RLS
-- ============================================================

ALTER TABLE time_templates ENABLE ROW LEVEL SECURITY;

-- Only the owning user sees/modifies their templates, and only within an
-- org they belong to.
CREATE POLICY "Users read their own templates"
  ON time_templates FOR SELECT
  USING (
    user_id = auth.uid()
    AND user_has_org_access(organization_id)
  );

CREATE POLICY "Users create templates for themselves"
  ON time_templates FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND user_has_org_access(organization_id)
  );

CREATE POLICY "Users update their own templates"
  ON time_templates FOR UPDATE
  USING (user_id = auth.uid() AND user_has_org_access(organization_id))
  WITH CHECK (user_id = auth.uid() AND user_has_org_access(organization_id));

CREATE POLICY "Users delete their own templates"
  ON time_templates FOR DELETE
  USING (user_id = auth.uid() AND user_has_org_access(organization_id));
