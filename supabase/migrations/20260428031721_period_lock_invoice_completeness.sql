-- Period-lock guard completeness fix.
--
-- Two holes in the original guard (20260428030840):
--
--   (1) The "status-only update allowlist" in
--       tg_invoices_period_lock_guard required equality on subtotal /
--       tax_rate / tax_amount / total / issued_date / due_date /
--       customer_id — but NOT currency. A user could flip a locked
--       invoice from USD → EUR and the guard waved it through, even
--       though that's a money-affecting change.
--
--   (2) Line items had no guard at all. A user could rewrite the
--       descriptions / quantities / amounts of any locked invoice's
--       line items by going at `invoice_line_items` directly. The
--       parent invoice's denormalized totals would then be stale, but
--       the bill the customer received is effectively rewritten.
--
-- Fix:
--   1. Replace tg_invoices_period_lock_guard so currency is in the
--      equality check.
--   2. Add tg_invoice_line_items_period_lock_guard that resolves the
--      parent invoice's team_id + issued_date and blocks writes when
--      they fall inside a lock.

-- ============================================================
-- 1. Tighten invoice guard — include currency
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

  v_target := CASE
    WHEN TG_OP = 'INSERT' THEN COALESCE(NEW.issued_date, CURRENT_DATE)
    ELSE COALESCE(OLD.issued_date, CURRENT_DATE)
  END;

  IF v_target <= v_lock_end THEN
    -- Status-only updates (sent → paid, paid → void) are allowed
    -- on locked invoices: a payment that lands in April for an
    -- invoice issued in March is normal, and voiding a paid invoice
    -- is a separate audit-trail concern. Anything that would
    -- silently rewrite the bill — money fields, currency, the
    -- customer it's billed to, or the dates that determine which
    -- period it belongs in — must NOT change.
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

-- ============================================================
-- 2. invoice_line_items guard
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_invoice_line_items_period_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_team_id    UUID;
  v_issued     DATE;
  v_lock_end   DATE;
BEGIN
  -- Resolve team + issued_date through the parent invoice. Use
  -- COALESCE(NEW, OLD) so the same lookup works for INSERT, UPDATE,
  -- and DELETE.
  SELECT i.team_id, COALESCE(i.issued_date, CURRENT_DATE)
    INTO v_team_id, v_issued
  FROM public.invoices i
  WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF v_team_id IS NULL THEN
    -- Parent invoice not found (concurrent delete?); let normal FK
    -- handling deal with it.
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_lock_end := public.team_period_lock_at(v_team_id);
  IF v_lock_end IS NULL OR v_issued > v_lock_end THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- The parent invoice itself is locked → no line-item writes.
  -- (Parent's status-only update path is irrelevant here because
  -- changing a line item is by definition not a status-only change.)
  RAISE EXCEPTION
    'Period closed: invoice line item belongs to invoice issued %, on or before the lock at %.',
    v_issued, v_lock_end
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_line_items_period_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_line_items_period_lock_guard();
