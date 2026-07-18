-- Deposit billing (2026-07-18 decision — SAL-049).
--
-- A proposal's deposit term (percent/amount) was decorative: Create Invoice
-- always billed the FULL fixed price. Now the author can bill the deposit
-- first. The lock model mirrors SAL-040's claim-first doctrine:
--
--   deposit_invoice_id — the ONE deposit invoice for this proposal. Claimed
--   via a conditional UPDATE (`… WHERE deposit_invoice_id IS NULL`) so two
--   concurrent "Bill deposit" clicks can't both create one; the loser's
--   just-created invoice is deleted (line items cascade). ON DELETE SET NULL
--   frees the deposit to re-bill if the invoice is deleted; the trigger below
--   does the same when it's VOIDED (void-unlock lineage, SAL-032/040).
--
-- The final (full) bill nets the deposit out as a negative manual line, so
-- the client never pays twice; item-level invoiced_at claims stay exclusive
-- to the FULL bill — a deposit never claims items.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS deposit_invoice_id UUID
    REFERENCES public.invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.proposals.deposit_invoice_id IS
  'The deposit invoice billed for this proposal (one max — conditional-update claimed, SAL-049). Cleared when that invoice is voided or deleted so the deposit can be re-billed.';

CREATE OR REPLACE FUNCTION public.release_deposit_link_on_void()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void' THEN
    UPDATE public.proposals
      SET deposit_invoice_id = NULL
      WHERE deposit_invoice_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_release_deposit_link ON public.invoices;
CREATE TRIGGER trg_invoices_release_deposit_link
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.release_deposit_link_on_void();
