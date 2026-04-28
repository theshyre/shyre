-- team_period_locks — bookkeeper-grade period close primitive.
--
-- A "lock" is one row keyed by `(team_id, period_end)`. When set, no
-- write to `time_entries`, `invoices`, or `expenses` may target a date
-- on or before `period_end` for that team. The trigger raises a
-- friendly error so the user understands the lock is what stopped
-- the write.
--
-- Why:
--   - Bookkeeper persona: closes Q1 books, sends client a P&L
--     summary. A member edits a January time entry on April 5;
--     billed total no longer matches the books. Without the lock,
--     drift is silent; with the lock, the edit fails fast.
--   - Tax prep: by definition, a closed-and-filed period must not
--     mutate. Period locks make that immutability explicit.
--
-- Locks are owner|admin-only — both creating and deleting. Removing
-- a lock is a one-way escape hatch for the rare "we have to amend";
-- both events are auditable via the rows themselves (no
-- soft-delete; an unlock removes the row but the actor + timestamp
-- live in `team_period_locks_history`).

CREATE TABLE public.team_period_locks (
  team_id            UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Last day of the locked period. Locks are inclusive — a row with
  -- period_end = '2026-03-31' means writes on or before
  -- 2026-03-31 are blocked.
  period_end         DATE NOT NULL,
  locked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes              TEXT,
  PRIMARY KEY (team_id, period_end)
);

CREATE INDEX idx_tpl_team_end
  ON public.team_period_locks (team_id, period_end DESC);

ALTER TABLE public.team_period_locks ENABLE ROW LEVEL SECURITY;

-- Owner|admin can read locks for their team. Locks themselves
-- aren't sensitive; the role gate matches the write side and keeps
-- a member from poking at the surface.
CREATE POLICY "tpl_select" ON public.team_period_locks FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "tpl_insert" ON public.team_period_locks FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY "tpl_delete" ON public.team_period_locks FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- No UPDATE — locks are immutable once set; if you got the date
-- wrong, delete it and create a new one. The history table records
-- both transitions.

-- ============================================================
-- Lock-check helper
-- ============================================================

-- Returns the latest period_end for a team, or NULL if none exists.
-- SECURITY DEFINER so triggers can call it without RLS interference.
CREATE OR REPLACE FUNCTION public.team_period_lock_at(p_team_id UUID)
RETURNS DATE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_latest DATE;
BEGIN
  SELECT MAX(period_end) INTO v_latest
  FROM public.team_period_locks
  WHERE team_id = p_team_id;
  RETURN v_latest;
END;
$$;

-- ============================================================
-- time_entries lock guard
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_time_entries_period_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_team_id   UUID;
  v_lock_end  DATE;
  v_target    DATE;
BEGIN
  -- Resolve team via projects → customers (time_entries has no
  -- direct team_id column).
  SELECT t.id INTO v_team_id
  FROM public.projects p
  JOIN public.customers c ON c.id = p.customer_id
  JOIN public.teams t ON t.id = c.team_id
  WHERE p.id = COALESCE(NEW.project_id, OLD.project_id);

  IF v_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_lock_end := public.team_period_lock_at(v_team_id);
  IF v_lock_end IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- For UPDATE / DELETE the protected date is the OLD row's start
  -- (you can't move a locked entry away). For INSERT it's NEW.
  v_target := CASE
    WHEN TG_OP = 'INSERT' THEN (NEW.start_time)::DATE
    ELSE (OLD.start_time)::DATE
  END;

  IF v_target <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: % is on or before the lock at %.',
      v_target, v_lock_end
      USING ERRCODE = 'check_violation',
            HINT = 'Unlock the period first, or talk to an owner/admin.';
  END IF;

  -- For UPDATE: also block moving an entry INTO a locked period.
  IF TG_OP = 'UPDATE' AND (NEW.start_time)::DATE <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: cannot move an entry into a locked period (% on or before %).',
      (NEW.start_time)::DATE, v_lock_end
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entries_period_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_period_lock_guard();

-- ============================================================
-- expenses lock guard
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_expenses_period_lock_guard()
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
    WHEN TG_OP = 'INSERT' THEN NEW.incurred_on
    ELSE OLD.incurred_on
  END;

  IF v_target <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: % is on or before the lock at %.',
      v_target, v_lock_end
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.incurred_on <= v_lock_end THEN
    RAISE EXCEPTION
      'Period closed: cannot move an expense into a locked period (% on or before %).',
      NEW.incurred_on, v_lock_end
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_period_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_expenses_period_lock_guard();

-- ============================================================
-- invoices lock guard
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

  -- Allow the status-stamping triggers (sent_at / paid_at /
  -- voided_at) to fire even if the underlying issued_date is
  -- locked — those just record events. The guard fires only on
  -- writes that touch invoiceable fields. Conservatively: gate any
  -- write where issued_date is in the locked window.
  IF v_target <= v_lock_end THEN
    -- Status-only updates (e.g. sent → paid) are allowed even on
    -- locked invoices: a payment landing in April for an invoice
    -- issued in March is normal.
    IF TG_OP = 'UPDATE'
       AND OLD.subtotal IS NOT DISTINCT FROM NEW.subtotal
       AND OLD.tax_rate IS NOT DISTINCT FROM NEW.tax_rate
       AND OLD.tax_amount IS NOT DISTINCT FROM NEW.tax_amount
       AND OLD.total IS NOT DISTINCT FROM NEW.total
       AND OLD.issued_date IS NOT DISTINCT FROM NEW.issued_date
       AND OLD.due_date IS NOT DISTINCT FROM NEW.due_date
       AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id
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

CREATE TRIGGER trg_invoices_period_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_period_lock_guard();

-- ============================================================
-- team_period_locks history
-- ============================================================

CREATE TABLE public.team_period_locks_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             UUID NOT NULL,
  period_end          DATE NOT NULL,
  operation           TEXT NOT NULL CHECK (operation IN ('INSERT', 'DELETE')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state      JSONB
);

CREATE INDEX idx_tplh_team
  ON public.team_period_locks_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_tpl_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.team_period_locks_history (
      team_id, period_end, operation, changed_by_user_id, previous_state
    ) VALUES (
      NEW.team_id, NEW.period_end, 'INSERT', auth.uid(), to_jsonb(NEW)
    );
    RETURN NEW;
  ELSE
    INSERT INTO public.team_period_locks_history (
      team_id, period_end, operation, changed_by_user_id, previous_state
    ) VALUES (
      OLD.team_id, OLD.period_end, 'DELETE', auth.uid(), to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tpl_log_change
  AFTER INSERT OR DELETE ON public.team_period_locks
  FOR EACH ROW EXECUTE FUNCTION public.tg_tpl_log_change();

ALTER TABLE public.team_period_locks_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tplh_select" ON public.team_period_locks_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));
