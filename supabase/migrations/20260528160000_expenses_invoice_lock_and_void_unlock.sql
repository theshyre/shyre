-- ============================================================
-- Phase 2 follow-up: DB-level invoiced lock for expenses + void
-- cascade + audit-trail-grade invoiced_at stamping.
--
-- The earlier phase-2 migration (20260528150000) added the
-- `invoiced/invoice_id/invoiced_at` columns and the action-layer
-- lock. Persona reviews caught three holes that need DB
-- enforcement:
--
--   1. **Lock is action-only.** A direct supabase-js write (or any
--      future RPC/import path) can mutate an invoiced expense
--      without ever hitting `updateExpenseAction`. Mirrors the
--      `tg_time_entries_invoice_lock_guard` precedent at
--      20260501040000.
--
--   2. **Void doesn't unlock expenses.** Bookkeeper review's #1:
--      `tg_invoices_void_unlock_entries` today only flips
--      `time_entries.invoiced = false, invoice_id = null` on void.
--      Expenses on a voided invoice stay locked forever, can't be
--      edited, can't be deleted, and (because the action filters
--      `eq("invoiced", false)`) can't be re-billed on a corrected
--      invoice. Silent money-trap. Fix: REPLACE the function to
--      cascade the unlock to both tables.
--
--   3. **`invoiced_at` from app clock.** Bookkeeper #3 — Vercel /
--      Supabase clock skew can produce out-of-order audit
--      timestamps. Fix: stamp `invoiced_at` via trigger on the
--      false→true transition using `now()`, so the value matches
--      DB time and matches `invoices.created_at` ordering.
--
-- All additive (new triggers, REPLACE on one existing function,
-- no column changes). Safe to ship with code.
-- ============================================================

-- 1. Lock guard on expenses.
-- Mirrors tg_time_entries_invoice_lock_guard verbatim. The two
-- unlock exceptions match: parent invoice is void (cascade unlock
-- in flight) OR the UPDATE clears both invoiced + invoice_id.
-- DELETE on an invoiced row is refused outright — same as the
-- time-entries pattern.
CREATE OR REPLACE FUNCTION public.tg_expenses_invoice_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_status TEXT;
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

  -- UPDATE allowed only on the unlock path (clearing both fields).
  -- Soft-delete (NEW.deleted_at non-null) is intentionally NOT
  -- exempt — soft-deleting an invoiced expense would orphan the
  -- line item's FK target. Restore (deleted_at: null) IS exempt
  -- because the row's accounting state isn't changing.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.invoiced IS NOT TRUE AND NEW.invoice_id IS NULL THEN
      RETURN NEW;
    END IF;
    -- Restore-only update: deleted_at flipped from non-null to null,
    -- nothing else changed.
    IF OLD.deleted_at IS NOT NULL
       AND NEW.deleted_at IS NULL
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.incurred_on IS NOT DISTINCT FROM OLD.incurred_on
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.category IS NOT DISTINCT FROM OLD.category
       AND NEW.vendor IS NOT DISTINCT FROM OLD.vendor
       AND NEW.billable IS NOT DISTINCT FROM OLD.billable
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'Expense is invoiced (invoice id %). Void the invoice first, or remove this line item from it.',
    OLD.invoice_id
    USING ERRCODE = 'check_violation',
          HINT = 'Open the invoice and void it, or remove this expense line.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_invoice_lock ON public.expenses;
CREATE TRIGGER trg_expenses_invoice_lock
  BEFORE UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_expenses_invoice_lock_guard();

-- 2. Auto-stamp invoiced_at on the false→true transition.
-- The app currently passes `new Date().toISOString()`; this trigger
-- overrides any caller-supplied value with `now()` so the
-- timestamp is always DB-clock authoritative.
CREATE OR REPLACE FUNCTION public.tg_expenses_stamp_invoiced_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoiced IS TRUE AND (OLD.invoiced IS NOT TRUE) THEN
    NEW.invoiced_at = now();
  END IF;
  -- Unlock path (true→false) clears invoiced_at so a future re-bill
  -- gets a fresh stamp, not a stale one from the original invoice.
  IF NEW.invoiced IS NOT TRUE AND OLD.invoiced IS TRUE THEN
    NEW.invoiced_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_stamp_invoiced_at ON public.expenses;
CREATE TRIGGER trg_expenses_stamp_invoiced_at
  BEFORE INSERT OR UPDATE OF invoiced ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_expenses_stamp_invoiced_at();

-- 3. REPLACE the existing invoice-void cascade to also unlock
-- expenses. The function name + signature stay the same, so the
-- trigger from 20260501040000 keeps pointing at the new body.
CREATE OR REPLACE FUNCTION public.tg_invoices_void_unlock_entries()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void' THEN
    UPDATE public.time_entries
    SET invoiced = FALSE, invoice_id = NULL
    WHERE invoice_id = NEW.id;
    -- Phase 2: expenses follow the same cascade. invoiced_at is
    -- cleared by the stamp-invoiced-at trigger above when invoiced
    -- flips back to FALSE, so we only need to flip the flag here.
    UPDATE public.expenses
    SET invoiced = FALSE, invoice_id = NULL
    WHERE invoice_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
