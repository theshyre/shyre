-- ============================================================
-- Proposals module — Phase 1: data model (proposals + line items)
-- ============================================================
--
-- Proposals are the missing front of Shyre's funnel: draft a fixed-price
-- quote → send it → get it signed off → convert accepted line items into
-- projects that time is tracked against and billed from. This migration lands
-- the authoring model only (P1). The sign-off surface (public access tokens,
-- acceptance records, forward event log, send-lock) arrives in P2's migration,
-- and convert/billing links in P3 — all additive.
--
-- Structural twin of Invoicing: `proposals` (unprefixed plural) + a
-- `proposal_line_items` child, each with an append-only `_history` audit twin
-- written only by a SECURITY DEFINER trigger. Money is NUMERIC(10,2) (dollars),
-- matching the invoice money model. RLS is owner/admin-only — a proposal is a
-- commercial document, same tier as an invoice.
--
-- Additive (CREATE TABLE / CREATE INDEX / ALTER TABLE ADD COLUMN /
-- CREATE OR REPLACE VIEW). Safe to ship code + migration in one PR. Timestamp
-- sorts after 20260716120000.

-- ============================================================
-- 1. team_settings: per-team proposal numbering (mirror invoice_prefix/num)
-- ============================================================

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS proposal_prefix   TEXT    NOT NULL DEFAULT 'PROP',
  ADD COLUMN IF NOT EXISTS proposal_next_num INTEGER NOT NULL DEFAULT 1;

-- Recreate team_settings_v to expose the two new columns (explicit column
-- list; appending at the end is CREATE OR REPLACE-safe). Preserves the exact
-- prior definition from 20260502170000_invoice_layout_options.sql.
CREATE OR REPLACE VIEW public.team_settings_v
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
  ts.wordmark_primary,
  ts.wordmark_secondary,
  ts.brand_color,
  ts.default_payment_terms_days,
  ts.show_country_on_invoice,
  ts.created_at,
  ts.updated_at,
  ts.rate_visibility,
  ts.rate_editability,
  ts.proposal_prefix,
  ts.proposal_next_num
FROM public.team_settings ts;

-- ============================================================
-- 2. proposals
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposals (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                 UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Prepared-by / author.
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  customer_id             UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  -- Intended signer (a person on the customer). Kept nullable + SET NULL so a
  -- deleted contact doesn't orphan the proposal.
  signer_contact_id       UUID REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  -- Issuer/branding entity snapshot ref (same concept as invoices.business_id).
  business_id             UUID REFERENCES public.businesses(id) ON DELETE RESTRICT,
  proposal_number         TEXT NOT NULL,
  title                   TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','sent','viewed','accepted','declined','converted','superseded')),
  issued_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until             DATE,
  -- Terms (frozen onto the proposal; feed the same payment-terms cascade as
  -- invoices when the accepted proposal is billed).
  payment_terms_days      INTEGER CHECK (payment_terms_days IS NULL OR (payment_terms_days >= 0 AND payment_terms_days <= 365)),
  payment_terms_label     TEXT,
  deposit_type            TEXT NOT NULL DEFAULT 'none' CHECK (deposit_type IN ('none','percent','amount')),
  deposit_value           NUMERIC(10,2) CHECK (deposit_value IS NULL OR deposit_value >= 0),
  warranty_days           INTEGER CHECK (warranty_days IS NULL OR warranty_days >= 0),
  terms_notes             TEXT,
  currency                CHAR(3) NOT NULL DEFAULT 'USD',
  -- Versioning: edit-after-sent produces a new row that supersedes the prior.
  version_number          INTEGER NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  supersedes_proposal_id  UUID REFERENCES public.proposals(id) ON DELETE SET NULL,
  -- Computed from the client's selected subset at acceptance time (P2).
  accepted_total          NUMERIC(10,2),
  -- Lifecycle timestamps, stamped server-side on first transition (P2 flips
  -- status; the trigger below stamps regardless of when transitions land).
  sent_at                 TIMESTAMPTZ,
  viewed_at               TIMESTAMPTZ,
  accepted_at             TIMESTAMPTZ,
  declined_at             TIMESTAMPTZ,
  converted_at            TIMESTAMPTZ,
  is_sample               BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (team_id, proposal_number)
);

CREATE INDEX IF NOT EXISTS idx_proposals_team     ON public.proposals (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_customer ON public.proposals (customer_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status   ON public.proposals (team_id, status);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

-- Owner/admin-only, all operations — a commercial document tier (mirrors the
-- invoices RLS tightening). INSERT/UPDATE additionally cross-check that the
-- customer belongs to the same team (defense-in-depth over the FK).
DROP POLICY IF EXISTS "proposals_select" ON public.proposals;
CREATE POLICY "proposals_select" ON public.proposals FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "proposals_insert" ON public.proposals;
CREATE POLICY "proposals_insert" ON public.proposals FOR INSERT
  WITH CHECK (
    public.user_team_role(team_id) IN ('owner','admin')
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.team_id = team_id)
  );

DROP POLICY IF EXISTS "proposals_update" ON public.proposals;
CREATE POLICY "proposals_update" ON public.proposals FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner','admin'))
  WITH CHECK (
    public.user_team_role(team_id) IN ('owner','admin')
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.team_id = team_id)
  );

DROP POLICY IF EXISTS "proposals_delete" ON public.proposals;
CREATE POLICY "proposals_delete" ON public.proposals FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner','admin'));

-- Actor stamp (created_by/updated_by), mirroring tg_invoices_stamp_actor.
CREATE OR REPLACE FUNCTION public.tg_proposals_stamp_actor()
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

DROP TRIGGER IF EXISTS trg_proposals_stamp_actor ON public.proposals;
CREATE TRIGGER trg_proposals_stamp_actor
  BEFORE INSERT OR UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposals_stamp_actor();

-- Status-transition timestamps, mirroring tg_invoices_status_timestamps. Only
-- stamps on the first transition into each status (guards against re-saves).
CREATE OR REPLACE FUNCTION public.tg_proposals_status_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF    NEW.status = 'sent'      AND NEW.sent_at      IS NULL THEN NEW.sent_at := now();
    ELSIF NEW.status = 'viewed'    AND NEW.viewed_at    IS NULL THEN NEW.viewed_at := now();
    ELSIF NEW.status = 'accepted'  AND NEW.accepted_at  IS NULL THEN NEW.accepted_at := now();
    ELSIF NEW.status = 'declined'  AND NEW.declined_at  IS NULL THEN NEW.declined_at := now();
    ELSIF NEW.status = 'converted' AND NEW.converted_at IS NULL THEN NEW.converted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proposals_status_timestamps ON public.proposals;
CREATE TRIGGER trg_proposals_status_timestamps
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposals_status_timestamps();

-- ============================================================
-- 3. proposal_line_items
-- ============================================================
--
-- A line item = a proposed project. `parent_line_item_id` (self-ref, one
-- level) models phases: a phased item's phases sum to its `fixed_price`, and
-- `is_capped` marks the total as a hard cap. The one-level-deep + same-proposal
-- + phase-sum/cap rules are enforced at the action layer in P1 (with tests);
-- DB-level guard triggers are a P4 hardening. Only top-level items
-- (parent_line_item_id IS NULL) are client-selectable at sign-off.

CREATE TABLE IF NOT EXISTS public.proposal_line_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  -- Denormalized so RLS + history role-check without joining proposals.
  team_id               UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  parent_line_item_id   UUID REFERENCES public.proposal_line_items(id) ON DELETE CASCADE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  title                 TEXT NOT NULL,
  description           TEXT,
  why_it_matters        TEXT,
  out_of_scope          TEXT,
  definition_of_done    TEXT,
  fixed_price           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fixed_price >= 0),
  -- On a parent: phases are capped so their sum can't exceed the quote.
  is_capped             BOOLEAN NOT NULL DEFAULT false,
  -- Set at convert time (P3): the project this item became.
  converted_project_id  UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- Set once billed (P3): double-bill lock for the fixed price.
  invoiced_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pli_proposal ON public.proposal_line_items (proposal_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pli_parent   ON public.proposal_line_items (parent_line_item_id);

ALTER TABLE public.proposal_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pli_select" ON public.proposal_line_items;
CREATE POLICY "pli_select" ON public.proposal_line_items FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "pli_insert" ON public.proposal_line_items;
CREATE POLICY "pli_insert" ON public.proposal_line_items FOR INSERT
  WITH CHECK (
    public.user_team_role(team_id) IN ('owner','admin')
    AND EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.team_id = team_id)
  );

DROP POLICY IF EXISTS "pli_update" ON public.proposal_line_items;
CREATE POLICY "pli_update" ON public.proposal_line_items FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner','admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "pli_delete" ON public.proposal_line_items;
CREATE POLICY "pli_delete" ON public.proposal_line_items FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner','admin'));

CREATE OR REPLACE FUNCTION public.tg_proposal_line_items_stamp_actor()
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

DROP TRIGGER IF EXISTS trg_pli_stamp_actor ON public.proposal_line_items;
CREATE TRIGGER trg_pli_stamp_actor
  BEFORE INSERT OR UPDATE ON public.proposal_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposal_line_items_stamp_actor();

-- ============================================================
-- 4. Append-only history twins (SECURITY DEFINER writes only)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposals_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         UUID NOT NULL,
  team_id             UUID NOT NULL,
  user_id             UUID,
  operation           TEXT NOT NULL CHECK (operation IN ('UPDATE','DELETE')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ph_proposal ON public.proposals_history (proposal_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ph_team     ON public.proposals_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_proposals_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.proposals_history (
    proposal_id, team_id, user_id, operation, changed_by_user_id, previous_state
  ) VALUES (
    OLD.id, OLD.team_id, OLD.user_id, TG_OP, auth.uid(), to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proposals_log_change ON public.proposals;
CREATE TRIGGER trg_proposals_log_change
  BEFORE UPDATE OR DELETE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposals_log_change();

ALTER TABLE public.proposals_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ph_select" ON public.proposals_history;
CREATE POLICY "ph_select" ON public.proposals_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));

CREATE TABLE IF NOT EXISTS public.proposal_line_items_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id        UUID NOT NULL,
  proposal_id         UUID NOT NULL,
  team_id             UUID NOT NULL,
  operation           TEXT NOT NULL CHECK (operation IN ('UPDATE','DELETE')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plih_item ON public.proposal_line_items_history (line_item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_plih_team ON public.proposal_line_items_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_proposal_line_items_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.proposal_line_items_history (
    line_item_id, proposal_id, team_id, operation, changed_by_user_id, previous_state
  ) VALUES (
    OLD.id, OLD.proposal_id, OLD.team_id, TG_OP, auth.uid(), to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pli_log_change ON public.proposal_line_items;
CREATE TRIGGER trg_pli_log_change
  BEFORE UPDATE OR DELETE ON public.proposal_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_proposal_line_items_log_change();

ALTER TABLE public.proposal_line_items_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plih_select" ON public.proposal_line_items_history;
CREATE POLICY "plih_select" ON public.proposal_line_items_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner','admin'));
