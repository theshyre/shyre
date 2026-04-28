-- SAL-012 — Tighten read access for business identity & registrations.
--
-- The 2026-04-27 whole-project audit flagged that any user with a
-- team in a business could SELECT:
--
--   - businesses.tax_id          (EIN — actual federal tax ID)
--   - businesses.date_incorporated
--   - businesses.fiscal_year_start
--   - business_state_registrations.*  (state IDs, registration #s)
--   - business_tax_registrations.*    (state-tax filing IDs)
--   - business_registered_agents.*    (agent contact info / addresses)
--
-- Same shape as SAL-010 / SAL-011 — write policies were correctly
-- gated to owner/admin, but SELECT rode the broader
-- `user_has_business_access` helper that returns TRUE for any team
-- member. A junior contributor in a 6-person shop should not be able
-- to SELECT the company's EIN out of the database via direct
-- PostgREST query, even if the form-rendering UI never displays it.
--
-- This migration:
--
--   1. Tightens SELECT on the three registrations tables to
--      owner|admin (members never need this surface — it's
--      compliance-tier).
--
--   2. Splits the sensitive identity columns (tax_id,
--      date_incorporated, fiscal_year_start) off `businesses` into a
--      new 1:1 child table `business_identity_private` with
--      owner|admin-only RLS on every operation.
--
--      The display-tier columns (`legal_name`, `entity_type`) stay on
--      `businesses` — members need to see "what business is this" on
--      pages they have access to (e.g. the business detail header).
--
--   3. Backfills the new table from the existing values, then NULLs
--      the old columns on `businesses` so a member doing
--      `select("tax_id")` against the wide table gets only NULL until
--      the contract migration drops them entirely.
--
--   4. Adds a sibling audit trail table
--      `business_identity_private_history` mirroring the existing
--      `businesses_history` shape so changes to the EIN /
--      incorporation date / fiscal year are still recoverable for
--      compliance — owner|admin SELECT only, append-only.
--
-- The `tax_id` etc. columns on `businesses` are intentionally kept
-- (NULL'd) for one PR cycle; a follow-up migration drops them per
-- the migrations playbook (expand → contract).

-- ============================================================
-- 1. Registrations: tighten SELECT to owner|admin
-- ============================================================

DROP POLICY IF EXISTS "bra_select" ON public.business_registered_agents;
CREATE POLICY "bra_select" ON public.business_registered_agents FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "bsr_select" ON public.business_state_registrations;
CREATE POLICY "bsr_select" ON public.business_state_registrations FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "btr_select" ON public.business_tax_registrations;
CREATE POLICY "btr_select" ON public.business_tax_registrations FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

-- ============================================================
-- 2. business_identity_private — sensitive identity child table
-- ============================================================

CREATE TABLE public.business_identity_private (
  business_id        UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  tax_id             TEXT,
  date_incorporated  DATE,
  fiscal_year_start  TEXT
    CHECK (fiscal_year_start IS NULL OR fiscal_year_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE  public.business_identity_private IS
  'Sensitive identity fields (EIN, incorporation date, fiscal year). Owner/admin only — split from businesses to enforce DB-level role gating per SAL-012.';
COMMENT ON COLUMN public.business_identity_private.tax_id IS 'EIN (US) or equivalent tax identifier. Not member-readable.';

ALTER TABLE public.business_identity_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bip_select" ON public.business_identity_private FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "bip_insert" ON public.business_identity_private FOR INSERT
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "bip_update" ON public.business_identity_private FOR UPDATE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "bip_delete" ON public.business_identity_private FOR DELETE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

-- Stamp actor + bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.tg_bip_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bip_stamp_actor
  BEFORE INSERT OR UPDATE ON public.business_identity_private
  FOR EACH ROW EXECUTE FUNCTION public.tg_bip_stamp_actor();

-- Ensure a private row exists for every business (existing + future).
INSERT INTO public.business_identity_private (
  business_id, tax_id, date_incorporated, fiscal_year_start
)
SELECT id, tax_id, date_incorporated, fiscal_year_start
FROM public.businesses;

-- Auto-create the private row when a new business is inserted, so
-- callers never need to insert it explicitly.
CREATE OR REPLACE FUNCTION public.tg_businesses_create_identity_private()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.business_identity_private (business_id)
  VALUES (NEW.id)
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_businesses_create_identity_private
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_businesses_create_identity_private();

-- NULL the deprecated columns on businesses. Members can no longer
-- read the EIN even by `select("tax_id")` against the wide table —
-- they get NULL. The column drop is a separate contract migration.
UPDATE public.businesses
SET tax_id = NULL,
    date_incorporated = NULL,
    fiscal_year_start = NULL;

COMMENT ON COLUMN public.businesses.tax_id IS
  'DEPRECATED: moved to business_identity_private (SAL-012). Always NULL after the migration; will be dropped in a follow-up contract migration.';
COMMENT ON COLUMN public.businesses.date_incorporated IS
  'DEPRECATED: moved to business_identity_private (SAL-012). Always NULL.';
COMMENT ON COLUMN public.businesses.fiscal_year_start IS
  'DEPRECATED: moved to business_identity_private (SAL-012). Always NULL.';

-- ============================================================
-- 3. business_identity_private audit trail
-- ============================================================

CREATE TABLE public.business_identity_private_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_biph_business
  ON public.business_identity_private_history (business_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_bip_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.business_identity_private_history (
    business_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.business_id,
    TG_OP,
    auth.uid(),
    to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bip_log_change
  BEFORE UPDATE OR DELETE ON public.business_identity_private
  FOR EACH ROW EXECUTE FUNCTION public.tg_bip_log_change();

ALTER TABLE public.business_identity_private_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biph_select" ON public.business_identity_private_history FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));
