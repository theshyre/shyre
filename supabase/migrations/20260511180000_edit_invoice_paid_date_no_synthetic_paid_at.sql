-- Hotfix to edit_invoice_paid_date: stop writing UTC-midnight values
-- into invoice_payments.paid_at.
--
-- Bug: the prior version set
--   paid_at = p_new_paid_on::TIMESTAMPTZ
-- on the synthetic-insert branch and the existing-row UPDATE branch.
-- In Postgres, that cast yields midnight UTC, which renders in
-- negative-offset timezones (Pacific, etc.) as the prior calendar
-- day. The activity log's payment subline (which prefers paid_at
-- over paid_on) then rendered "marcus on May 7 at 5:00 PM" for an
-- invoice paid on May 8.
--
-- Original column intent (per migration 20260430232000):
--   'Actual paid timestamp when known (e.g. from a Harvest import). '
--   'Falls back to paid_on for display when null.'
-- Honor that contract: paid_at is NULL unless we have a real,
-- non-derived timestamp (Harvest import). The RPC should never
-- synthesize a "midnight UTC" stamp that pretends to be one.
--
-- Display-side fixes for headers and the activity log subline ship
-- alongside this migration (paid-date-block.tsx, invoice-activity.tsx).
--
-- No data backfill in this PR: existing synthetic-midnight rows are
-- harmless once the display code is fixed, and the heuristic for
-- distinguishing "synthetic" from "Harvest" timestamps has edge
-- cases. If a user wants to clean a specific row up, they can re-run
-- the edit and it'll pass through the fixed code path.

CREATE OR REPLACE FUNCTION public.edit_invoice_paid_date(
  p_invoice_id UUID,
  p_new_paid_on DATE,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invoice    public.invoices%ROWTYPE;
  v_role       TEXT;
  v_lock_end   DATE;
  v_old_paid   DATE;
  v_count      INT;
  v_dates      TEXT;
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Invoice id is required.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_new_paid_on IS NULL THEN
    RAISE EXCEPTION 'New paid date is required.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A correction reason of at least 10 characters is required.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found.'
      USING ERRCODE = 'no_data_found';
  END IF;

  v_role := public.user_team_role(v_invoice.team_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can edit a paid date.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_invoice.status <> 'paid' THEN
    RAISE EXCEPTION 'Only paid invoices have an editable paid date.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_invoice.issued_date IS NOT NULL
     AND p_new_paid_on < v_invoice.issued_date
  THEN
    RAISE EXCEPTION 'Paid date (%) cannot precede the issued date (%).',
      p_new_paid_on, v_invoice.issued_date
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_new_paid_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'Paid date (%) cannot be in the future.',
      p_new_paid_on
      USING ERRCODE = 'check_violation';
  END IF;

  v_old_paid := v_invoice.paid_at::DATE;
  v_lock_end := public.team_period_lock_at(v_invoice.team_id);
  IF v_lock_end IS NOT NULL THEN
    IF p_new_paid_on <= v_lock_end THEN
      RAISE EXCEPTION
        'Period closed: % is on or before the lock at %.',
        p_new_paid_on, v_lock_end
        USING ERRCODE = 'check_violation',
              HINT = 'Unlock the period first, or pick a date inside an open period.';
    END IF;
    IF v_old_paid IS NOT NULL AND v_old_paid <= v_lock_end THEN
      RAISE EXCEPTION
        'Period closed: cannot edit a paid date inside the locked period (was %, lock %).',
        v_old_paid, v_lock_end
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM set_config('shyre.correction_reason', p_reason, true);

  SELECT COUNT(*) INTO v_count
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  IF v_count = 0 THEN
    -- Legacy 0-payment invoice. Insert a synthetic record so
    -- invoice_payments stays canonical going forward. paid_at is
    -- NULL because we genuinely don't know the moment of payment —
    -- only the date the user supplied. The original column comment
    -- (migration 20260430232000) says "Falls back to paid_on for
    -- display when null"; honor that contract.
    INSERT INTO public.invoice_payments (
      invoice_id, team_id, amount, currency, paid_on, paid_at,
      method, reference, created_by_user_id
    ) VALUES (
      p_invoice_id,
      v_invoice.team_id,
      v_invoice.total,
      v_invoice.currency,
      p_new_paid_on,
      NULL,
      NULL,
      NULL,
      auth.uid()
    );
  ELSIF v_count = 1 THEN
    -- Single payment row is canonical. Update only paid_on; leave
    -- paid_at untouched. If paid_at was a real Harvest-recorded
    -- timestamp, the user changing the date does NOT mean they want
    -- to invalidate that timestamp; if it was already NULL, it
    -- stays NULL (correct).
    UPDATE public.invoice_payments
    SET paid_on = p_new_paid_on
    WHERE invoice_id = p_invoice_id;
  ELSE
    SELECT string_agg(paid_on::TEXT, ', ' ORDER BY paid_on)
    INTO v_dates
    FROM public.invoice_payments
    WHERE invoice_id = p_invoice_id;

    RAISE EXCEPTION
      'This invoice has % payments dated %. Edit individual payments instead.',
      v_count, v_dates
      USING ERRCODE = 'check_violation',
            HINT = 'Per-payment editing is not yet available in the UI.';
  END IF;

  -- Mirror the new date onto invoices.paid_at. Stored as UTC
  -- midnight; the display layer formats it as the UTC date
  -- component (see paid-date-block.tsx) so negative-offset TZs
  -- don't flip the visible day.
  UPDATE public.invoices
  SET paid_at = p_new_paid_on::TIMESTAMPTZ
  WHERE id = p_invoice_id;
END;
$$;
