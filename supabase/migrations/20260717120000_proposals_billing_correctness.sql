-- ============================================================
-- Proposals v2 — billing correctness (bookkeeper review)
-- ============================================================
--
-- Four defects in the shipped proposal→invoice path, all additive:
--   1. No structured link from an invoice back to the proposal it billed —
--      reconciliation was text-parsing a line description. Add FK columns
--      and widen the source mutex to 3-way.
--   2. Voiding/deleting the generated invoice never released the
--      `proposal_line_items.invoiced_at` double-bill lock → the item was
--      stranded "billed" forever. Extend the invoice-void cascade + add a
--      line-delete release (mirrors the expenses void-unlock, SAL/bookkeeper
--      precedent in 20260528160000).
--   3. Tax floated after signing: the acceptance froze a pre-tax total but the
--      invoice applied the team-default rate at bill time. Snapshot the rate
--      onto the acceptance so every bill of a signed deal uses the rate in
--      force when it was signed.
--   4. `superseded` had no timestamp column (every other status did).
--
-- Timestamp sorts after 20260716170000.

-- ------------------------------------------------------------
-- 1. Structured invoice ↔ proposal link
-- ------------------------------------------------------------

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES public.proposals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_proposal ON public.invoices (proposal_id);

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS proposal_line_item_id UUID
    REFERENCES public.proposal_line_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ili_proposal_line_item
  ON public.invoice_line_items (proposal_line_item_id);

-- Widen the source mutex: a line item has AT MOST one source (time entry,
-- expense, or proposal line item) — else it's a manual/ad-hoc line.
ALTER TABLE public.invoice_line_items
  DROP CONSTRAINT IF EXISTS invoice_line_items_source_mutex;
ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT invoice_line_items_source_mutex CHECK (
    (CASE WHEN time_entry_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN expense_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN proposal_line_item_id IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

-- ------------------------------------------------------------
-- 2. Release the double-bill lock on void / delete
-- ------------------------------------------------------------

-- Extend the existing invoice-void cascade (name/signature unchanged, so the
-- trigger from 20260501040000 keeps pointing at the new body) to also clear
-- invoiced_at on proposal line items billed on the voided invoice.
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

    UPDATE public.expenses
    SET invoiced = FALSE, invoice_id = NULL
    WHERE invoice_id = NEW.id;

    -- Proposals: free the fixed-price items so the work can be re-invoiced
    -- on a corrected invoice. invoiced_at is in the send-lock mutable list,
    -- so this write is allowed on a non-draft proposal.
    UPDATE public.proposal_line_items
    SET invoiced_at = NULL
    WHERE id IN (
      SELECT li.proposal_line_item_id
      FROM public.invoice_line_items li
      WHERE li.invoice_id = NEW.id
        AND li.proposal_line_item_id IS NOT NULL
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Belt-and-suspenders: if an invoice (or just a line) is hard-deleted, the
-- cascade removes invoice_line_items — release the linked proposal item too,
-- so no delete path can strand an item as "billed" with no live invoice.
CREATE OR REPLACE FUNCTION public.tg_ili_release_proposal_lock()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.proposal_line_item_id IS NOT NULL THEN
    UPDATE public.proposal_line_items
    SET invoiced_at = NULL
    WHERE id = OLD.proposal_line_item_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ili_release_proposal_lock ON public.invoice_line_items;
CREATE TRIGGER trg_ili_release_proposal_lock
  AFTER DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_ili_release_proposal_lock();

-- ------------------------------------------------------------
-- 3. Snapshot the tax rate onto the acceptance record
-- ------------------------------------------------------------

ALTER TABLE public.proposal_acceptances
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2);

-- ------------------------------------------------------------
-- 4. superseded_at timestamp (stamped by the status-timestamp trigger)
-- ------------------------------------------------------------

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.tg_proposals_status_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF    NEW.status = 'sent'       AND NEW.sent_at       IS NULL THEN NEW.sent_at := now();
    ELSIF NEW.status = 'viewed'     AND NEW.viewed_at     IS NULL THEN NEW.viewed_at := now();
    ELSIF NEW.status = 'accepted'   AND NEW.accepted_at   IS NULL THEN NEW.accepted_at := now();
    ELSIF NEW.status = 'declined'   AND NEW.declined_at   IS NULL THEN NEW.declined_at := now();
    ELSIF NEW.status = 'converted'  AND NEW.converted_at  IS NULL THEN NEW.converted_at := now();
    ELSIF NEW.status = 'superseded' AND NEW.superseded_at IS NULL THEN NEW.superseded_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
