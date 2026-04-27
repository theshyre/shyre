-- Append-only audit trail for `businesses` and `business_state_registrations`.
--
-- Mirrors the pattern established for `business_people` in
-- 20260427220047. The same arguments apply: audit-grade visibility
-- of changes that matter for compliance / legal disputes.
--
--   businesses                       — legal_name, EIN (tax_id),
--                                      entity_type, fiscal year,
--                                      incorporation date. Changing
--                                      any of these mid-year is a
--                                      tax-prep red flag.
--   business_state_registrations     — registration_status flips,
--                                      next_due_date moves, withdrawal
--                                      / revocation events.
--
-- Both tables get the same shape:
--
--   1. created_by_user_id / updated_by_user_id columns on the source
--      table, populated automatically from auth.uid() via a BEFORE
--      INSERT/UPDATE trigger.
--   2. <table>_history table — captures full row state pre-change as
--      JSONB on every UPDATE / DELETE. Append-only by construction
--      (no client-facing INSERT/UPDATE/DELETE policies; only the
--      SECURITY DEFINER trigger writes).
--
-- INSERTs aren't logged — the row + its created_at/by is the
-- creation record.

-- ============================================================
-- 1. businesses
-- ============================================================

ALTER TABLE public.businesses
  ADD COLUMN created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_businesses_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_businesses_stamp_actor
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_businesses_stamp_actor();

CREATE TABLE public.businesses_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_bh_business
  ON public.businesses_history (business_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_businesses_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.businesses_history (
    business_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
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

CREATE TRIGGER trg_businesses_log_change
  BEFORE UPDATE OR DELETE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_businesses_log_change();

ALTER TABLE public.businesses_history ENABLE ROW LEVEL SECURITY;

-- Owner/admin only — change history of legal name / EIN / fiscal
-- year is not member-grade information.
CREATE POLICY "bh_select" ON public.businesses_history FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

-- ============================================================
-- 2. business_state_registrations
-- ============================================================

ALTER TABLE public.business_state_registrations
  ADD COLUMN created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_bsr_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bsr_stamp_actor
  BEFORE INSERT OR UPDATE ON public.business_state_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_bsr_stamp_actor();

CREATE TABLE public.business_state_registrations_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id          UUID NOT NULL,
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_bsrh_registration
  ON public.business_state_registrations_history (registration_id, changed_at DESC);

CREATE INDEX idx_bsrh_business
  ON public.business_state_registrations_history (business_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_bsr_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.business_state_registrations_history (
    registration_id,
    business_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
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

CREATE TRIGGER trg_bsr_log_change
  BEFORE UPDATE OR DELETE ON public.business_state_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_bsr_log_change();

ALTER TABLE public.business_state_registrations_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bsrh_select" ON public.business_state_registrations_history FOR SELECT
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));
