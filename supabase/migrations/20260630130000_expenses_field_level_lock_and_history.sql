-- Field-level invoice lock for expenses + expenses_history audit trail.
--
-- Until now an invoiced expense (`invoiced = true` on a live invoice)
-- was FULLY locked: every column rejected edits at both the action
-- layer and `tg_expenses_invoice_lock_guard`. Invoices SNAPSHOT
-- expenses (createInvoiceAction freezes the line description + copies
-- the amount; the invoice detail page and PDF render from the stored
-- snapshot, never live from the expense), so editing an invoiced
-- expense's *metadata* cannot alter the issued invoice. This migration
-- relaxes the lock to FIELD level:
--
--   Locked while invoiced  : amount, currency, incurred_on (date),
--                            project_id, billable  (+ the lock columns
--                            invoiced / invoice_id / invoiced_at, and
--                            anything else by default).
--   Editable while invoiced: external_reference, description, notes,
--                            vendor, category.
--
-- `incurred_on` stays LOCKED (bookkeeper + security review): it is
-- baked into the frozen invoice line text and the period-lock guard
-- only protects *closed* periods, so a date edit could silently shift
-- a billed expense across an open-period boundary. Genuine date fixes
-- go through void → edit → re-bill.
--
-- Two parts:
--   1. expenses_history — append-only audit (SAL-034). Mutability of
--      invoiced rows without a trail is the regression we must not
--      ship; mirrors time_entries_history / projects_history.
--   2. tg_expenses_invoice_lock_guard rewritten as DEFAULT-DENY: a
--      jsonb strip-list, NOT a per-locked-column allow-list. Stripping
--      the metadata keys and requiring the remainder byte-identical
--      means any column added by a future migration is locked on an
--      invoiced row until someone deliberately adds it to `meta`.
--
-- Additive (one CREATE TABLE + CREATE OR REPLACE on one function).
-- Both parallel-deploy interleavings fail closed. Timestamp sorts
-- after 20260628120000 (and 20260630120000).

-- ============================================================
-- expenses_history (SAL-034)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expenses_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id               UUID NOT NULL,
  -- Denormalized so the SELECT policy role-checks without joining
  -- expenses (which may be gone by the time history is read forensically).
  team_id                  UUID NOT NULL,
  -- Original logger of the expense — useful for display even after the
  -- expenses row is deleted.
  user_id                  UUID,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eh_expense
  ON public.expenses_history (expense_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_eh_team
  ON public.expenses_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_expenses_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- expenses carries team_id directly (no projects→customers join
  -- needed, unlike time_entries).
  INSERT INTO public.expenses_history (
    expense_id,
    team_id,
    user_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
    OLD.team_id,
    OLD.user_id,
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

-- Named 'l...' so it fires (alphabetically) AFTER the invoice-lock
-- guard ('i...') and BEFORE the period guard ('p...') — a blocked edit
-- RAISEs in a sibling trigger and rolls back this INSERT, so history
-- never records an edit that didn't happen.
DROP TRIGGER IF EXISTS trg_expenses_log_change ON public.expenses;
CREATE TRIGGER trg_expenses_log_change
  BEFORE UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_expenses_log_change();

ALTER TABLE public.expenses_history ENABLE ROW LEVEL SECURITY;

-- Owner/admin of the team only — change history of a financial record
-- is an administrative surface (mirrors projects_history). No client
-- INSERT/UPDATE/DELETE; only the SECURITY DEFINER trigger writes.
DROP POLICY IF EXISTS "eh_select" ON public.expenses_history;
CREATE POLICY "eh_select" ON public.expenses_history FOR SELECT
  USING (
    public.user_team_role(team_id) IN ('owner', 'admin')
  );

-- ============================================================
-- Field-aware invoice-lock guard (replaces the all-or-nothing body
-- from 20260628120000_expenses_external_reference.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_expenses_invoice_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_status TEXT;
  -- Metadata columns editable while the expense is on a live invoice.
  -- Kept in lockstep with INVOICED_EDITABLE_EXPENSE_FIELDS (TS) by a
  -- parity test. DEFAULT-DENY: any column NOT named here — including
  -- columns added by future migrations — stays locked on an invoiced
  -- row. Do NOT replace this with a per-locked-column
  -- `IS DISTINCT FROM` allow-list: that leaks new financial columns.
  meta CONSTANT text[] := ARRAY[
    'external_reference', 'description', 'notes', 'vendor', 'category'
  ];
BEGIN
  IF OLD.invoiced IS NOT TRUE OR OLD.invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  -- Invoice already void OR gone → expense is implicitly unlocked.
  IF v_invoice_status = 'void' OR v_invoice_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- 1. Unlock path: clearing both lock columns detaches the expense.
    IF NEW.invoiced IS NOT TRUE AND NEW.invoice_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- 2. Restore path: a pure soft-delete recovery (deleted_at flips
    --    null) where NOTHING ELSE changed. jsonb strip-list form so a
    --    future column can't ride in on a restore.
    IF OLD.deleted_at IS NOT NULL
       AND NEW.deleted_at IS NULL
       AND (to_jsonb(OLD) - 'deleted_at') = (to_jsonb(NEW) - 'deleted_at')
    THEN
      RETURN NEW;
    END IF;

    -- 3. Metadata path: allow only changes confined to the metadata
    --    columns. Strip them from both row images; require the
    --    remainder byte-identical. Any financial / lock / unknown
    --    column that differs fails this and falls through to RAISE.
    IF (to_jsonb(OLD) - meta) = (to_jsonb(NEW) - meta) THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'Expense is invoiced (invoice id %). Amount, project, currency, billable, and date are locked — void the invoice first, or remove this line item from it.',
    OLD.invoice_id
    USING ERRCODE = 'check_violation',
          HINT = 'Reference #, description, notes, vendor, and category stay editable; void the invoice to change the rest.';
END;
$$ LANGUAGE plpgsql;
