-- Make invoices.paid_at editable (post-paid) via a single SECURITY
-- DEFINER RPC so the two-row update (invoices + the canonical
-- invoice_payments row) is atomic and audit-recorded with intent.
--
-- Motivation:
--   - Pre-existing paid invoices created by the legacy one-click
--     "Mark Paid" button (and Harvest imports) carry `paid_at =
--     now()` instead of the actual receipt date. Cash-basis reports
--     and period-close pivot on `paid_at` — a wrong date pollutes
--     the period.
--   - The new Record Payment form (shipped earlier the same day)
--     records the correct `paid_on` via `invoice_payments` and
--     mirrors it onto `invoices.paid_at`. But it can't retro-fix the
--     legacy invoices that have no payment row.
--
-- Design (per personas: bookkeeper + security + ux-designer):
--   1. invoice_payments is the canonical source of truth for paid_on.
--      invoices.paid_at is the denormalization. They must agree.
--   2. The edit must be atomic across the two tables — wrap in this
--      RPC; never let the action issue two separate UPDATEs that can
--      partially fail.
--   3. Correction requires a free-text reason (>= 10 chars), captured
--      in invoices_history so an auditor can see *why* revenue moved
--      across a period — not just a JSONB field diff.
--   4. Period locks are enforced on BOTH the old and the new dates.
--      The existing `tg_invoices_period_lock_guard` ALLOWS status-
--      only updates through (the guard only fires on subtotal /
--      total / issued_date / etc. changes — see migration
--      20260428030840 line 199 comment), and `invoice_payments` has
--      no period-lock guard at all today. This function fills that
--      gap explicitly.
--   5. Multi-payment invoices (>= 2 rows) reject with the payment
--      dates surfaced — there's no payments-edit UI yet; the user
--      must wait for that or edit via SQL.
--
-- Out of scope (per shipping plan, deferred to follow-up):
--   - Owner-only tiering for cross-period edits (today: owner | admin
--     uniformly).
--   - Typed-confirm escalation for cross-month / cross-fiscal-year
--     edits.
--   - A real payments-edit UI for the multi-payment case.

-- ============================================================
-- 1. invoices_history: capture the correction reason
-- ============================================================
ALTER TABLE public.invoices_history
  ADD COLUMN IF NOT EXISTS correction_reason TEXT;

COMMENT ON COLUMN public.invoices_history.correction_reason IS
  'Free-text intent string supplied by edit_invoice_paid_date and '
  'any future correction RPCs. NULL on ordinary status-mutation '
  'updates (which do not require a reason). The trigger reads this '
  'from `current_setting(''shyre.correction_reason'', true)` so it '
  'works without a column-list change inside the RPC.';

-- Replace the history-write trigger so it picks up the optional
-- correction reason from a session-local GUC. Existing call sites
-- (every non-correction UPDATE/DELETE on invoices) leave the GUC
-- unset; current_setting(..., missing_ok := true) returns '' and
-- we coerce to NULL.
CREATE OR REPLACE FUNCTION public.tg_invoices_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reason TEXT;
BEGIN
  v_reason := NULLIF(current_setting('shyre.correction_reason', true), '');
  INSERT INTO public.invoices_history (
    invoice_id, team_id, operation, changed_by_user_id, previous_state,
    correction_reason
  ) VALUES (
    OLD.id, OLD.team_id, TG_OP, auth.uid(), to_jsonb(OLD), v_reason
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. The RPC
-- ============================================================
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

  -- Bookkeeper rule: cash basis requires paid_on >= issued_date
  -- (the cash can't precede the bill).
  IF v_invoice.issued_date IS NOT NULL
     AND p_new_paid_on < v_invoice.issued_date
  THEN
    RAISE EXCEPTION 'Paid date (%) cannot precede the issued date (%).',
      p_new_paid_on, v_invoice.issued_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- No future-dated revenue recognition. Most users entering a
  -- future date are typo'ing the year.
  IF p_new_paid_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'Paid date (%) cannot be in the future.',
      p_new_paid_on
      USING ERRCODE = 'check_violation';
  END IF;

  -- Period locks: enforce on BOTH the new date AND the old date.
  -- Moving a date *out of* a locked period is just as much a
  -- violation as moving one *into* one. The existing
  -- tg_invoices_period_lock_guard does not catch this case
  -- because it allows status-only updates through.
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

  -- Stamp the reason into the session GUC so the history trigger
  -- captures it on the upcoming UPDATE. Local=true → scoped to this
  -- transaction.
  PERFORM set_config('shyre.correction_reason', p_reason, true);

  SELECT COUNT(*) INTO v_count
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  IF v_count = 0 THEN
    -- Legacy path: paid_at is the only signal that this invoice was
    -- paid. Create a synthetic payment row so the two tables are in
    -- sync going forward. Amount = invoice.total (full payment),
    -- currency inherits from the invoice, method/reference NULL
    -- (the user can complete the record later via the payments UI
    -- when it ships).
    INSERT INTO public.invoice_payments (
      invoice_id, team_id, amount, currency, paid_on, paid_at,
      method, reference, created_by_user_id
    ) VALUES (
      p_invoice_id,
      v_invoice.team_id,
      v_invoice.total,
      v_invoice.currency,
      p_new_paid_on,
      p_new_paid_on::TIMESTAMPTZ,
      NULL,
      NULL,
      auth.uid()
    );
  ELSIF v_count = 1 THEN
    -- The single payment row is canonical. Update its paid_on; also
    -- refresh its paid_at when it was previously a midnight stamp
    -- derived from paid_on (the Harvest-import case sets a real
    -- paid_at and we preserve it).
    UPDATE public.invoice_payments
    SET paid_on = p_new_paid_on,
        paid_at = CASE
          WHEN paid_at IS NULL THEN p_new_paid_on::TIMESTAMPTZ
          WHEN paid_at::DATE = paid_on THEN p_new_paid_on::TIMESTAMPTZ
          ELSE paid_at
        END
    WHERE invoice_id = p_invoice_id;
  ELSE
    -- 2+ payments: ambiguous which row defines "paid date." Surface
    -- the dates so the user knows what to look at.
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

  -- Mirror the new date onto invoices.paid_at. The history trigger
  -- reads `shyre.correction_reason` and persists it on this UPDATE.
  UPDATE public.invoices
  SET paid_at = p_new_paid_on::TIMESTAMPTZ
  WHERE id = p_invoice_id;
END;
$$;

COMMENT ON FUNCTION public.edit_invoice_paid_date(UUID, DATE, TEXT) IS
  'Owner/admin: correct the paid date on a paid invoice. Updates '
  'the canonical invoice_payments row (creating one for legacy '
  '0-payment invoices). Reason >= 10 chars. Period locks enforced '
  'on both old and new dates.';

REVOKE ALL ON FUNCTION public.edit_invoice_paid_date(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_invoice_paid_date(UUID, DATE, TEXT)
  TO authenticated;
