-- Money-integrity batch B1 (2026-07-19 bookkeeper audit).
--
-- 1. `invoice_payments` was the ONLY money table without an append-only
--    `_history` twin — the cash ledger had an erasable past: owner/admin
--    RLS grants full UPDATE/DELETE, so a recorded $5,000 payment could
--    become $5,200 (or vanish) leaving only a fresh updated_at. Mirror
--    the invoices_history pattern (SAL-011).
--
-- 2. `invoice_payments` had NO period-lock guard — and the action-layer
--    comment claimed one existed. After a quarter is locked, a payment
--    with paid_on inside the lock could be inserted, edited, or deleted,
--    silently changing the cash-basis Collected totals already handed to
--    a CPA. Guard INSERT/UPDATE/DELETE on paid_on (old AND new), same
--    dual-date discipline as the edit_invoice_paid_date RPC.
--
-- 3. The time_entries period-lock guard resolved the team via
--    projects → customers → teams; internal projects (customer_id NULL,
--    20260504190000) resolved to NULL and the guard RETURNED WITHOUT
--    CHECKING — closed-period internal hours were freely editable.
--    time_entries.team_id is NOT NULL since 002; use it directly.
--
-- 4. The locked-invoice status-only allow-list omitted the discount
--    fields: a discount_amount/discount_rate edit that left `total`
--    untouched passed on a locked invoice, breaking
--    subtotal − discount + tax = total inside a closed period.
--
-- 5. SAL-033 (open since 2026-05-28): nothing enforced
--    customers.team_id = projects.team_id. Close it with a parity
--    trigger before the next cross-module path leans on the invariant.
--
-- All changes are additive or strictly-tightening; safe to ship with
-- code in one PR.

-- ============================================================
-- 1. invoice_payments_history (append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_payments_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID NOT NULL,
  invoice_id         UUID NOT NULL,
  team_id            UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  operation          TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state     JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_iph_payment
  ON public.invoice_payments_history (payment_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_iph_invoice
  ON public.invoice_payments_history (invoice_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_iph_team
  ON public.invoice_payments_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_invoice_payments_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.invoice_payments_history (
    payment_id, invoice_id, team_id, operation, changed_by_user_id, previous_state
  ) VALUES (
    OLD.id, OLD.invoice_id, OLD.team_id, TG_OP, auth.uid(), to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_payments_log_change ON public.invoice_payments;
CREATE TRIGGER trg_invoice_payments_log_change
  BEFORE UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_payments_log_change();

ALTER TABLE public.invoice_payments_history ENABLE ROW LEVEL SECURITY;

-- Same gate as the payments themselves — bookkeeper-grade metadata.
DROP POLICY IF EXISTS "iph_select" ON public.invoice_payments_history;
CREATE POLICY "iph_select" ON public.invoice_payments_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));
-- No INSERT/UPDATE/DELETE policies: only the definer trigger writes.

-- ============================================================
-- 2. period-lock guard on invoice_payments
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_invoice_payments_period_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_team_id  UUID;
  v_lock_end DATE;
BEGIN
  -- Resolve via the parent invoice, not NEW.team_id — on INSERT the
  -- set_team trigger may not have fired yet (alphabetical ordering).
  SELECT team_id INTO v_team_id
  FROM public.invoices
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_lock_end := public.team_period_lock_at(v_team_id);
  IF v_lock_end IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Dual-date check (same discipline as edit_invoice_paid_date): the
  -- row's existing paid_on can't be inside the lock (you can't touch a
  -- closed-period payment), and the incoming paid_on can't land inside
  -- it either (you can't backdate cash into a closed period).
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.paid_on <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: payment dated % is on or before the lock at %.',
      OLD.paid_on, v_lock_end
      USING ERRCODE = 'check_violation',
            HINT = 'Unlock the period first, or talk to an owner/admin.';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.paid_on <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: cannot record a payment dated % on or before the lock at %.',
      NEW.paid_on, v_lock_end
      USING ERRCODE = 'check_violation',
            HINT = 'Unlock the period first, or talk to an owner/admin.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_payments_period_lock_guard ON public.invoice_payments;
CREATE TRIGGER trg_invoice_payments_period_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_payments_period_lock_guard();

-- ============================================================
-- 3. time_entries guard: direct team_id (internal-project fix)
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_time_entries_period_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_team_id   UUID;
  v_lock_end  DATE;
  v_target    DATE;
BEGIN
  -- time_entries carries team_id directly (NOT NULL since 002). The
  -- previous projects → customers → teams walk returned NULL for
  -- internal projects (customer_id IS NULL) and skipped the check.
  v_team_id := COALESCE(NEW.team_id, OLD.team_id);

  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_lock_end := public.team_period_lock_at(v_team_id);
  IF v_lock_end IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- For UPDATE / DELETE the protected date is the OLD row's start
  -- (you can't move a locked entry away). For INSERT it's NEW.
  v_target := CASE
    WHEN TG_OP = 'INSERT' THEN (NEW.start_time)::DATE
    ELSE (OLD.start_time)::DATE
  END;

  IF v_target <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: % is on or before the lock at %.',
      v_target, v_lock_end
      USING ERRCODE = 'check_violation',
            HINT = 'Unlock the period first, or talk to an owner/admin.';
  END IF;

  -- For UPDATE: also block moving an entry INTO a locked period.
  IF TG_OP = 'UPDATE' AND (NEW.start_time)::DATE <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: cannot move an entry into a locked period (% on or before %).',
      (NEW.start_time)::DATE, v_lock_end
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. locked-invoice allow-list: discount fields join the equality set
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_invoices_period_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_lock_end DATE;
  v_target   DATE;
BEGIN
  v_lock_end := public.team_period_lock_at(COALESCE(NEW.team_id, OLD.team_id));
  IF v_lock_end IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Draft exemption: a draft (NULL issued_date) is staging work,
  -- not a billable record. INSERTing or DELETing one is free.
  -- UPDATEs that promote a draft to sent (setting issued_date
  -- inside the lock) still trip the equality check below.
  IF TG_OP = 'INSERT' AND NEW.issued_date IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.issued_date IS NULL THEN
    RETURN OLD;
  END IF;

  v_target := CASE
    WHEN TG_OP = 'INSERT' THEN COALESCE(NEW.issued_date, CURRENT_DATE)
    ELSE COALESCE(OLD.issued_date, CURRENT_DATE)
  END;

  IF v_target <= v_lock_end THEN
    -- Status-only update allowlist: see the original migration
    -- (20260428031721) for the rationale. Currency is in the
    -- equality check; a flip would be a money change. Discount
    -- fields added 2026-07-20 (bookkeeper audit): a discount edit
    -- that left `total` untouched previously passed on a locked
    -- invoice, breaking subtotal − discount + tax = total inside a
    -- closed period.
    IF TG_OP = 'UPDATE'
       AND OLD.subtotal        IS NOT DISTINCT FROM NEW.subtotal
       AND OLD.discount_amount IS NOT DISTINCT FROM NEW.discount_amount
       AND OLD.discount_rate   IS NOT DISTINCT FROM NEW.discount_rate
       AND OLD.tax_rate        IS NOT DISTINCT FROM NEW.tax_rate
       AND OLD.tax_amount      IS NOT DISTINCT FROM NEW.tax_amount
       AND OLD.total           IS NOT DISTINCT FROM NEW.total
       AND OLD.currency        IS NOT DISTINCT FROM NEW.currency
       AND OLD.issued_date     IS NOT DISTINCT FROM NEW.issued_date
       AND OLD.due_date        IS NOT DISTINCT FROM NEW.due_date
       AND OLD.customer_id     IS NOT DISTINCT FROM NEW.customer_id
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Period closed: invoice issued %, on or before the lock at %.',
      v_target, v_lock_end
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. SAL-033: projects ↔ customers team parity
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_projects_customer_team_parity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = NEW.customer_id
      AND c.team_id = NEW.team_id
  ) THEN
    RAISE EXCEPTION
      'projects.customer_id % does not belong to projects.team_id %',
      NEW.customer_id, NEW.team_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_customer_team_parity ON public.projects;
CREATE TRIGGER trg_projects_customer_team_parity
  BEFORE INSERT OR UPDATE OF customer_id, team_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_projects_customer_team_parity();
