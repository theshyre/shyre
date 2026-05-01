-- time_entries → invoice lock guard.
--
-- Time entries already get marked `invoiced = true, invoice_id = <id>`
-- when an invoice's line items are generated against them, AND when
-- imported from Harvest with a billed link. Until now nothing
-- enforced "invoiced means immutable" — a user could still edit
-- duration / description on an entry that's already shipped to a
-- customer. Bookkeepers expect frozen.
--
-- This migration adds two triggers:
--
--   1. tg_time_entries_invoice_lock_guard — refuses UPDATE / DELETE
--      on invoiced rows. Two narrow exceptions:
--        a. The linked invoice's status is already 'void' — entries
--           are unlocked once the invoice is voided (and trigger #2
--           below physically unlinks them anyway).
--        b. The UPDATE clears invoiced + invoice_id (the unlock
--           path used by the void cascade or undo flows).
--      Period-lock guard (added in 20260428030840) and this one
--      stack: a row that's both invoiced AND in a locked period
--      requires both conditions to be cleared first.
--
--   2. tg_invoices_void_unlock_entries — when an invoice flips to
--      status = 'void', physically unlink its time entries
--      (invoiced = false, invoice_id = null) so the user can edit
--      them again. Without this the lock would persist until the
--      invoice was deleted.
--
-- INSERT path is left alone — the import + the invoice generator
-- both set invoiced/invoice_id on insert and we don't want to
-- block them.
--
-- This is additive (new triggers, no schema changes), but it's
-- behavior-changing for any caller that was edit-after-invoice
-- without realizing. Worth it: a silently-mutated invoiced entry
-- is the bookkeeper's nightmare scenario.

CREATE OR REPLACE FUNCTION public.tg_time_entries_invoice_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_status TEXT;
BEGIN
  -- Not invoiced — nothing to guard.
  IF OLD.invoiced IS NOT TRUE OR OLD.invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Look up the invoice's status. If the invoice is already void,
  -- the entry is implicitly unlocked (trigger #2 below physically
  -- unlinks them, but cover the in-flight case too).
  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  IF v_invoice_status = 'void' OR v_invoice_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- UPDATE: allow the unlock-path mutation (clearing both flags) so
  -- the void-trigger cascade and any future undo flow work. Any
  -- other UPDATE on an invoiced entry is refused.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.invoiced IS NOT TRUE AND NEW.invoice_id IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'Time entry is invoiced (invoice id %). Void the invoice first, or remove this entry from it.',
    OLD.invoice_id
    USING ERRCODE = 'check_violation',
          HINT = 'Open the invoice and void it, or remove this line item.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entries_invoice_lock
  BEFORE UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_invoice_lock_guard();

-- Void-unlock trigger. Fires after a successful UPDATE on the
-- invoice itself. Uses SECURITY DEFINER so the cascade runs even if
-- the caller doesn't have direct UPDATE on time_entries (it would
-- normally — invoice owner usually owns the entries — but defense
-- in depth, and the bypass is needed because the lock-guard trigger
-- above accepts unlock-path mutations only when status='void',
-- which IS true at this point).
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_void_unlock
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_void_unlock_entries();
