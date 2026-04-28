-- Period-lock guard relax: draft invoices are exempt.
--
-- Security review finding #6: the original guard rejected INSERT
-- on `invoices` whenever today fell inside a lock window, because
-- `COALESCE(NEW.issued_date, CURRENT_DATE)` against `NULL` (a draft)
-- returned today. That blocked draft creation entirely whenever
-- the user had a forward-looking lock — e.g. "lock through April
-- 30" set on April 5 prevented every subsequent draft until May.
--
-- Drafts have no economic effect — they're staging work, not
-- billable rows. The status-only update path already lets `draft
-- → sent` fire on a previously-issued invoice; symmetrically,
-- creating a fresh draft inside the window should be free. The
-- guard tightens the moment the user finalizes (sets a real
-- `issued_date` and / or moves status off draft), at which point
-- the standard equality check kicks in.
--
-- Same treatment for line items: when the parent invoice is a
-- draft (no issued_date), line-item writes pass through.

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
    -- equality check; a flip would be a money change.
    IF TG_OP = 'UPDATE'
       AND OLD.subtotal     IS NOT DISTINCT FROM NEW.subtotal
       AND OLD.tax_rate     IS NOT DISTINCT FROM NEW.tax_rate
       AND OLD.tax_amount   IS NOT DISTINCT FROM NEW.tax_amount
       AND OLD.total        IS NOT DISTINCT FROM NEW.total
       AND OLD.currency     IS NOT DISTINCT FROM NEW.currency
       AND OLD.issued_date  IS NOT DISTINCT FROM NEW.issued_date
       AND OLD.due_date     IS NOT DISTINCT FROM NEW.due_date
       AND OLD.customer_id  IS NOT DISTINCT FROM NEW.customer_id
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

CREATE OR REPLACE FUNCTION public.tg_invoice_line_items_period_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_team_id    UUID;
  v_issued     DATE;
  v_status     TEXT;
  v_lock_end   DATE;
BEGIN
  -- Resolve team + issued_date + status through the parent invoice.
  SELECT i.team_id, i.issued_date, i.status
    INTO v_team_id, v_issued, v_status
  FROM public.invoices i
  WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Draft parent → line-item writes pass through. Same rationale
  -- as the parent's draft exemption.
  IF v_issued IS NULL OR v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_lock_end := public.team_period_lock_at(v_team_id);
  IF v_lock_end IS NULL OR v_issued > v_lock_end THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'Period closed: invoice line item belongs to invoice issued %, on or before the lock at %.',
    v_issued, v_lock_end
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
