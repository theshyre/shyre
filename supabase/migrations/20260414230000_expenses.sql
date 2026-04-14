-- Business expenses table. Scoped per-organization. Authors can edit/delete
-- their own rows; org owners/admins can edit/delete any row in the org.
--
-- Amount stored as numeric(10,2) to match the rate columns elsewhere.
-- Categories are a small fixed enum via CHECK constraint — can be relaxed
-- later without a schema migration.

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  incurred_on date NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  vendor text,
  category text NOT NULL CHECK (category IN (
    'software',
    'hardware',
    'subscriptions',
    'travel',
    'meals',
    'office',
    'professional_services',
    'fees',
    'other'
  )),
  description text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  billable boolean NOT NULL DEFAULT false,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_org_date_idx
  ON public.expenses (organization_id, incurred_on DESC);

CREATE INDEX IF NOT EXISTS expenses_user_idx
  ON public.expenses (user_id);

CREATE INDEX IF NOT EXISTS expenses_project_idx
  ON public.expenses (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_sample_idx
  ON public.expenses (organization_id)
  WHERE is_sample;

-- RLS

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Any member of the org can read expenses in that org.
CREATE POLICY "expenses_select" ON public.expenses FOR SELECT
  USING (public.user_has_org_access(organization_id));

-- Authors insert their own rows in orgs they belong to.
CREATE POLICY "expenses_insert" ON public.expenses FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_has_org_access(organization_id)
  );

-- Author or org owner/admin can update.
CREATE POLICY "expenses_update" ON public.expenses FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.user_org_role(organization_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.user_org_role(organization_id) IN ('owner', 'admin')
  );

-- Author or org owner/admin can delete.
CREATE POLICY "expenses_delete" ON public.expenses FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.user_org_role(organization_id) IN ('owner', 'admin')
  );
