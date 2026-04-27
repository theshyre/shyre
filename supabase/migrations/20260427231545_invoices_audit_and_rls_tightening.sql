-- SAL-011: Invoices RLS + audit trail
--
-- Two related tightenings on the same surface:
--
-- 1. INVOICES + INVOICE_LINE_ITEMS RLS — prior policies (added in
--    009_resource_sharing) gated SELECT/INSERT/UPDATE on
--    `user_has_team_access(team_id)`, which means any team member
--    could read every team invoice and silently mutate it. The same
--    leak we closed for `time_entries` in SAL-006 and for
--    `business_people` in SAL-010 — invoices is the most
--    audit-sensitive table in the app and was the loosest. Tighten
--    SELECT/INSERT/UPDATE to owner|admin (DELETE was already right).
--    The customer-admin escape hatch on SELECT is preserved so a
--    contractor with explicit permission on a customer can still
--    see invoices issued to that customer.
--
-- 2. AUDIT TRAIL on `invoices` + `invoice_line_items` — mirrors the
--    pattern used for business_people / businesses /
--    business_state_registrations. created_by/updated_by columns
--    auto-populated from auth.uid() via BEFORE INSERT/UPDATE
--    trigger. Append-only `_history` tables capture full row state
--    pre-change as JSONB on every UPDATE/DELETE. Only the
--    SECURITY DEFINER trigger can write to history.
--
-- Both pieces are tightenings (less access, more visibility); safe
-- to ship code + migration in one PR.

-- ============================================================
-- 1. RLS tightening
-- ============================================================

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;

CREATE POLICY "invoices_select" ON public.invoices FOR SELECT
  USING (
    public.user_team_role(team_id) IN ('owner', 'admin')
    OR (
      customer_id IS NOT NULL
      AND public.user_customer_permission(customer_id) = 'admin'
    )
  );

CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT
  WITH CHECK (
    public.user_team_role(team_id) IN ('owner', 'admin')
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = customer_id AND c.team_id = invoices.team_id
      )
    )
  );

CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

-- DELETE was already owner|admin — leave it.

-- invoice_line_items inherit visibility from their parent invoice.
-- Existing policies (set in 002_multi_tenant.sql) gated on
-- user_has_team_access via the parent — re-create with the same
-- owner|admin gate at the row level for defense in depth.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoice_line_items' AND policyname = 'Org members manage invoice line items'
  ) THEN
    DROP POLICY "Org members manage invoice line items" ON public.invoice_line_items;
  END IF;
END $$;

DROP POLICY IF EXISTS "invoice_line_items_select" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_line_items_insert" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_line_items_update" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_line_items_delete" ON public.invoice_line_items;

CREATE POLICY "invoice_line_items_select" ON public.invoice_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND (
          public.user_team_role(i.team_id) IN ('owner', 'admin')
          OR (
            i.customer_id IS NOT NULL
            AND public.user_customer_permission(i.customer_id) = 'admin'
          )
        )
    )
  );

CREATE POLICY "invoice_line_items_insert" ON public.invoice_line_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND public.user_team_role(i.team_id) IN ('owner', 'admin')
    )
  );

CREATE POLICY "invoice_line_items_update" ON public.invoice_line_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND public.user_team_role(i.team_id) IN ('owner', 'admin')
    )
  );

CREATE POLICY "invoice_line_items_delete" ON public.invoice_line_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND public.user_team_role(i.team_id) IN ('owner', 'admin')
    )
  );

-- ============================================================
-- 2. Audit columns on invoices + invoice_line_items
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_line_items
  ADD COLUMN created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_invoices_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_stamp_actor
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_stamp_actor();

CREATE OR REPLACE FUNCTION public.tg_invoice_line_items_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_line_items_stamp_actor
  BEFORE INSERT OR UPDATE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_line_items_stamp_actor();

-- ============================================================
-- 3. invoices_history (append-only)
-- ============================================================

CREATE TABLE public.invoices_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id               UUID NOT NULL,
  team_id                  UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_ih_invoice
  ON public.invoices_history (invoice_id, changed_at DESC);

CREATE INDEX idx_ih_team
  ON public.invoices_history (team_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_invoices_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.invoices_history (
    invoice_id, team_id, operation, changed_by_user_id, previous_state
  ) VALUES (
    OLD.id, OLD.team_id, TG_OP, auth.uid(), to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_log_change
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_log_change();

ALTER TABLE public.invoices_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ih_select" ON public.invoices_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

-- ============================================================
-- 4. invoice_line_items_history
-- ============================================================

CREATE TABLE public.invoice_line_items_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id             UUID NOT NULL,
  invoice_id               UUID NOT NULL,
  team_id                  UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_ilih_invoice
  ON public.invoice_line_items_history (invoice_id, changed_at DESC);

CREATE INDEX idx_ilih_line_item
  ON public.invoice_line_items_history (line_item_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_invoice_line_items_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  parent_team_id UUID;
BEGIN
  -- Look up the parent invoice's team_id for the history row's
  -- denormalized `team_id`. The invoice may already be deleted
  -- (CASCADE from team delete), but in normal mutations the parent
  -- exists.
  SELECT team_id INTO parent_team_id
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  -- If we couldn't resolve the parent (extreme edge case during
  -- concurrent invoice delete), fall through and skip the audit
  -- write rather than aborting the whole operation. The invoice
  -- itself is being deleted; history coverage of its line items is
  -- best-effort here.
  IF parent_team_id IS NOT NULL THEN
    INSERT INTO public.invoice_line_items_history (
      line_item_id, invoice_id, team_id, operation,
      changed_by_user_id, previous_state
    ) VALUES (
      OLD.id, OLD.invoice_id, parent_team_id, TG_OP, auth.uid(), to_jsonb(OLD)
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_line_items_log_change
  BEFORE UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_line_items_log_change();

ALTER TABLE public.invoice_line_items_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ilih_select" ON public.invoice_line_items_history FOR SELECT
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));
