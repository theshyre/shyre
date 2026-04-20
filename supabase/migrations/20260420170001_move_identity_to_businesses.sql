-- Move business identity from team_settings to businesses.
--
-- PR-2 of three. PR-1 (20260420170000) created the businesses table
-- and backfilled identity from team_settings rows. This migration:
--
--   1. Adds invoices.business_id NOT NULL — denormalized from
--      teams.business_id at issue time. Invoices are legal documents;
--      their issuer must be stable even if the owning team is later
--      re-parented (which the guard trigger blocks, but defense in
--      depth matters for audit history).
--   2. Auto-populates invoices.business_id on INSERT via trigger so
--      existing callers don't need to know about the column.
--   3. Drops the seven identity columns from team_settings — the
--      backfill in PR-1 already copied them to businesses; keeping
--      them on team_settings would immediately drift.
--   4. Rewrites team_settings_v (the rate-masking view) to no longer
--      re-select the dropped columns.
--
-- After this migration, the business module reads/writes identity
-- exclusively via the businesses table (see src/app/(dashboard)/
-- business/** in the same PR).

-- ============================================================
-- 1. invoices.business_id — denormalized snapshot
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE RESTRICT;

-- Backfill: every existing invoice gets its team's current business.
UPDATE public.invoices
  SET business_id = t.business_id
  FROM public.teams t
  WHERE t.id = public.invoices.team_id
    AND public.invoices.business_id IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN business_id SET NOT NULL;

CREATE INDEX idx_invoices_business_id
  ON public.invoices (business_id);

-- BEFORE INSERT trigger: populate business_id from teams.business_id
-- if the caller didn't set it. Keeps every existing invoice insertion
-- site working unchanged.
CREATE OR REPLACE FUNCTION public.tg_invoices_set_business_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id IS NULL THEN
    SELECT business_id INTO NEW.business_id
      FROM public.teams
      WHERE id = NEW.team_id;
    IF NEW.business_id IS NULL THEN
      RAISE EXCEPTION 'Team % has no business_id — cannot create invoice', NEW.team_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_business_id_default
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_set_business_id();

-- ============================================================
-- 2. Rewrite team_settings_v (drop moved columns)
-- ============================================================
--
-- Postgres refuses CREATE OR REPLACE VIEW when the new SELECT has a
-- different column list. Drop-then-recreate is the supported path.
-- Callers of this view: src/app/(dashboard)/teams/[id]/page.tsx,
-- src/app/(dashboard)/invoices/new/page.tsx (select invoice_prefix /
-- invoice_next_num / tax_rate / default_rate — unaffected),
-- src/__integration__/rls/rate-visibility.test.ts (default_rate only).
-- None of them read the identity columns via the view.

DROP VIEW IF EXISTS public.team_settings_v;

CREATE VIEW public.team_settings_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  ts.team_id,
  ts.business_name,
  ts.business_email,
  ts.business_address,
  ts.business_phone,
  ts.logo_url,
  CASE WHEN public.can_view_team_rate(ts.team_id) THEN ts.default_rate ELSE NULL END AS default_rate,
  ts.invoice_prefix,
  ts.invoice_next_num,
  ts.tax_rate,
  ts.created_at,
  ts.updated_at,
  ts.rate_visibility,
  ts.rate_editability
FROM public.team_settings ts;

-- ============================================================
-- 3. Drop identity columns from team_settings
-- ============================================================

ALTER TABLE public.team_settings
  DROP COLUMN legal_name,
  DROP COLUMN entity_type,
  DROP COLUMN tax_id,
  DROP COLUMN state_registration_id,
  DROP COLUMN registered_state,
  DROP COLUMN date_incorporated,
  DROP COLUMN fiscal_year_start;
