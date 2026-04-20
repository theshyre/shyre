-- Business state registrations, tax registrations, and registered agents.
--
-- PR-3 of three. PR-1 introduced `businesses` as a first-class entity;
-- PR-2 moved identity columns onto it. This migration adds the multi-
-- state registration model the whole split was for.
--
-- Three tables, all FK to businesses(id):
--
--   business_state_registrations
--     Symmetric — the business's formation state and every foreign
--     qualification live as rows in the same table, distinguished by
--     `is_formation = true` (partial unique index enforces exactly
--     one). This preserves audit history through re-domestication
--     (e.g. DE LLC converts to TX LLC) — the row updates instead of
--     vanishing.
--
--   business_tax_registrations
--     Separate table for sales/use tax — different registration,
--     different filing cadence (monthly/quarterly vs annual), often
--     different ID. Co-locating with foreign qualifications would
--     create filtering noise every time we render either list.
--
--   business_registered_agents
--     Dedicated entity — a single agent (CSC, CT, Northwest) commonly
--     serves one business across 30+ states. Making it a separate
--     table avoids duplicating structured addresses per state.
--
-- Authorization is derived via `user_business_role(business_id)` —
-- owners/admins of any team owned by the business can edit.

-- ============================================================
-- 1. business_registered_agents
-- ============================================================

CREATE TABLE public.business_registered_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  address_line1  TEXT NOT NULL,
  address_line2  TEXT,
  city           TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  postal_code    TEXT NOT NULL,
  country        TEXT NOT NULL DEFAULT 'US',
  contact_email  TEXT,
  contact_phone  TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX idx_bra_business
  ON public.business_registered_agents (business_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_bra_updated_at
  BEFORE UPDATE ON public.business_registered_agents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 2. business_state_registrations
-- ============================================================

CREATE TABLE public.business_state_registrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  state                    TEXT NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  is_formation             BOOLEAN NOT NULL DEFAULT false,
  registration_type        TEXT NOT NULL CHECK (registration_type IN (
                             'domestic', 'foreign_qualification'
                           )),
  entity_number            TEXT,
  state_tax_id             TEXT,
  registered_on            DATE,
  nexus_start_date         DATE,
  registration_status      TEXT NOT NULL DEFAULT 'pending' CHECK (registration_status IN (
                             'pending', 'active', 'delinquent', 'withdrawn', 'revoked'
                           )),
  withdrawn_on             DATE,
  revoked_on               DATE,
  report_frequency         TEXT CHECK (report_frequency IS NULL OR report_frequency IN (
                             'annual', 'biennial', 'decennial'
                           )),
  due_rule                 TEXT CHECK (due_rule IS NULL OR due_rule IN (
                             'fixed_date', 'anniversary', 'quarter_end'
                           )),
  annual_report_due_mmdd   TEXT CHECK (
                             annual_report_due_mmdd IS NULL
                             OR annual_report_due_mmdd ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
                           ),
  next_due_date            DATE,
  annual_report_fee_cents  INTEGER CHECK (
                             annual_report_fee_cents IS NULL
                             OR annual_report_fee_cents >= 0
                           ),
  registered_agent_id      UUID REFERENCES public.business_registered_agents(id) ON DELETE SET NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,

  -- A formation row must be of type 'domestic' — formation is where
  -- the entity was actually formed, not where it's foreign-qualified.
  CONSTRAINT bsr_formation_requires_domestic CHECK (
    is_formation = false OR registration_type = 'domestic'
  ),
  -- Status flips that lose a date leave us unable to answer "when did
  -- this business stop being registered here?" at audit time.
  CONSTRAINT bsr_withdrawn_has_date CHECK (
    registration_status <> 'withdrawn' OR withdrawn_on IS NOT NULL
  ),
  CONSTRAINT bsr_revoked_has_date CHECK (
    registration_status <> 'revoked' OR revoked_on IS NOT NULL
  )
);

-- Exactly one formation row per business (symmetric model's anchor).
CREATE UNIQUE INDEX bsr_one_formation_per_business
  ON public.business_state_registrations (business_id)
  WHERE is_formation = true AND deleted_at IS NULL;

-- A business can only register once per state — multiple rows for the
-- same state indicate either a duplicate or a withdraw-then-reregister
-- that should archive the old row first.
CREATE UNIQUE INDEX bsr_one_state_per_business
  ON public.business_state_registrations (business_id, state)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_bsr_agent
  ON public.business_state_registrations (registered_agent_id)
  WHERE registered_agent_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_bsr_updated_at
  BEFORE UPDATE ON public.business_state_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 3. business_tax_registrations
-- ============================================================

CREATE TABLE public.business_tax_registrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  state                    TEXT NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  tax_type                 TEXT NOT NULL CHECK (tax_type IN (
                             'sales_use', 'seller_use', 'consumer_use', 'gross_receipts'
                           )),
  permit_number            TEXT,
  registered_on            DATE,
  nexus_start_date         DATE,
  tax_registration_status  TEXT NOT NULL DEFAULT 'pending' CHECK (tax_registration_status IN (
                             'pending', 'active', 'delinquent', 'closed'
                           )),
  closed_on                DATE,
  filing_frequency         TEXT CHECK (filing_frequency IS NULL OR filing_frequency IN (
                             'monthly', 'quarterly', 'annual', 'semi_annual'
                           )),
  next_filing_due          DATE,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,

  CONSTRAINT btr_closed_has_date CHECK (
    tax_registration_status <> 'closed' OR closed_on IS NOT NULL
  )
);

CREATE UNIQUE INDEX btr_one_state_type_per_business
  ON public.business_tax_registrations (business_id, state, tax_type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_btr_updated_at
  BEFORE UPDATE ON public.business_tax_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 4. RLS — all three tables scoped via user_business_role
-- ============================================================

ALTER TABLE public.business_registered_agents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_state_registrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_tax_registrations     ENABLE ROW LEVEL SECURITY;

-- Select: any team member of any team owned by this business can read.
-- Write: owner/admin of any such team can write.
CREATE POLICY "bra_select" ON public.business_registered_agents FOR SELECT
  USING (public.user_has_business_access(business_id));
CREATE POLICY "bra_insert" ON public.business_registered_agents FOR INSERT
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));
CREATE POLICY "bra_update" ON public.business_registered_agents FOR UPDATE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));
CREATE POLICY "bra_delete" ON public.business_registered_agents FOR DELETE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "bsr_select" ON public.business_state_registrations FOR SELECT
  USING (public.user_has_business_access(business_id));
CREATE POLICY "bsr_insert" ON public.business_state_registrations FOR INSERT
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));
CREATE POLICY "bsr_update" ON public.business_state_registrations FOR UPDATE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));
CREATE POLICY "bsr_delete" ON public.business_state_registrations FOR DELETE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "btr_select" ON public.business_tax_registrations FOR SELECT
  USING (public.user_has_business_access(business_id));
CREATE POLICY "btr_insert" ON public.business_tax_registrations FOR INSERT
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));
CREATE POLICY "btr_update" ON public.business_tax_registrations FOR UPDATE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));
CREATE POLICY "btr_delete" ON public.business_tax_registrations FOR DELETE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));
