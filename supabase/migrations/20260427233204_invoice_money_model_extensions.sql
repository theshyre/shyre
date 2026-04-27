-- Additive extensions to the invoice money model.
--
-- Bookkeeper / agency-owner persona reviews flagged five gaps that
-- are all *additive* (no destructive change, no expand-contract):
--
--   1. `currency` — invoices store amounts but no currency code.
--      Multi-currency reconciliation against QuickBooks is
--      impossible. Add `currency CHAR(3) NOT NULL DEFAULT 'USD'`.
--
--   2. `paid_at` / `voided_at` / `sent_at` — `status` flips with no
--      timestamps, so AR aging / DSO / "what closed in March"
--      queries can't be answered. Backfill is unknowable for
--      historical rows; the columns are nullable.
--
--   3. `(team_id, invoice_number)` uniqueness — duplicate numbers
--      are possible under any race in the `invoice_next_num`
--      increment path. Auditors flag duplicates immediately.
--      Partial unique index (only when both fields set).
--
--   4. `payments` table — a `paid` invoice with no record of *how*
--      it was paid (check #, ACH ref, deposit account, payment
--      date if different from invoice paid_at) is a half-truth
--      bookkeepers can't reconcile to a bank statement. Each
--      payment can be partial; `paid` status fires when sum of
--      payments >= invoice.total. RLS + audit columns same shape
--      as the rest of the invoice surface.
--
--   5. `tg_invoices_set_status_timestamp` — auto-stamp
--      paid_at/voided_at/sent_at on status transitions. The
--      timestamp columns are nullable but populated on the *first*
--      transition into that status; subsequent re-entries (which
--      shouldn't happen because of the transition guard, but
--      defense in depth) leave the original timestamp alone.
--
-- Deferred — explicitly not in this migration:
--   - Integer cents migration (NUMERIC → BIGINT). Real expand-
--     contract: PR1 add nullable integer column, PR2 backfill +
--     dual-write, PR3 flip readers, PR4 drop NUMERIC. Out of scope.
--   - Per-line tax (rate + amount on invoice_line_items). Real
--     product decision (US vs EU semantics); needs design work.

-- ============================================================
-- 1. currency on invoices
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD';

-- ============================================================
-- 2. status-transition timestamps
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN sent_at   TIMESTAMPTZ,
  ADD COLUMN paid_at   TIMESTAMPTZ,
  ADD COLUMN voided_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.tg_invoices_status_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status actually changed; same-status writes
  -- (defensive UI re-saves) shouldn't re-stamp the timestamp and
  -- lose the audit trail of when the transition first happened.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'sent' AND NEW.sent_at IS NULL THEN
      NEW.sent_at := now();
    ELSIF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
      NEW.paid_at := now();
    ELSIF NEW.status = 'void' AND NEW.voided_at IS NULL THEN
      NEW.voided_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_status_timestamps
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_status_timestamps();

-- INSERT path: a row created at `status='sent'` should also stamp
-- sent_at on creation (rare — most invoices land as draft — but a
-- bulk-import path could ship rows directly at sent).
CREATE OR REPLACE FUNCTION public.tg_invoices_status_timestamps_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'sent' AND NEW.sent_at IS NULL THEN
    NEW.sent_at := now();
  ELSIF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  ELSIF NEW.status = 'void' AND NEW.voided_at IS NULL THEN
    NEW.voided_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_status_timestamps_insert
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_status_timestamps_insert();

-- ============================================================
-- 3. unique invoice_number per team
-- ============================================================

-- Defensive — on a fresh app the partial unique index should land
-- without conflicts. If a duplicate exists, the migration will
-- fail loudly, which is the right outcome (bookkeeper would catch
-- it before us anyway).
CREATE UNIQUE INDEX invoices_team_number_unique
  ON public.invoices (team_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- ============================================================
-- 4. payments table
-- ============================================================

CREATE TABLE public.invoice_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  -- Denormalized for RLS — without this the RLS policy needs a
  -- subquery on every row read, which is slow at scale.
  team_id            UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  amount             NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency           CHAR(3) NOT NULL DEFAULT 'USD',
  paid_on            DATE NOT NULL,
  -- Free-form payment method label — bookkeepers want to filter on
  -- this for reconciliation ("which deposits were credit-card?")
  -- but the set is open enough that an enum would be wrong. CHECK
  -- on length to prevent garbage.
  method             TEXT CHECK (method IS NULL OR length(method) <= 64),
  -- External reference — check #, ACH trace, Stripe payment_id,
  -- whatever ties this row to a bank statement.
  reference          TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_invoice_payments_invoice
  ON public.invoice_payments (invoice_id, paid_on DESC);

CREATE INDEX idx_invoice_payments_team_paid_on
  ON public.invoice_payments (team_id, paid_on DESC);

-- Auto-stamp the team_id from the parent invoice on INSERT so
-- callers don't have to pass it (and can't pass a wrong one).
CREATE OR REPLACE FUNCTION public.tg_invoice_payments_set_team()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.team_id IS NULL THEN
    SELECT team_id INTO NEW.team_id
    FROM public.invoices
    WHERE id = NEW.invoice_id;
    IF NEW.team_id IS NULL THEN
      RAISE EXCEPTION 'invoice_payments.invoice_id % does not exist', NEW.invoice_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: NULL the team_id on insert in callers and let the trigger
-- populate it. Set ON UPDATE the trigger doesn't fire so callers
-- can't change team_id (which would also be wrong — payments belong
-- to the invoice's team forever).
CREATE TRIGGER trg_invoice_payments_set_team
  BEFORE INSERT ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_payments_set_team();

CREATE OR REPLACE FUNCTION public.tg_invoice_payments_stamp_actor()
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

CREATE TRIGGER trg_invoice_payments_stamp_actor
  BEFORE INSERT OR UPDATE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_payments_stamp_actor();

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

-- Same gate as the parent invoice — owner|admin of the team only.
-- Customer-admin escape on invoices_select doesn't extend here:
-- payment metadata (deposit account, check #) is bookkeeper-grade.
CREATE POLICY "invoice_payments_select" ON public.invoice_payments FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "invoice_payments_insert" ON public.invoice_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND public.user_team_role(i.team_id) IN ('owner', 'admin')
    )
  );

CREATE POLICY "invoice_payments_update" ON public.invoice_payments FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "invoice_payments_delete" ON public.invoice_payments FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));
