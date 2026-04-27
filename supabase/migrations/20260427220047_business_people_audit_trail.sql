-- Append-only audit trail for business_people.
--
-- HR data — compensation, employment_type flips (W-2 → 1099 for tax-
-- arbitrage abuse), termination dates — is exactly what an audit
-- trail exists for. The original table has `updated_at` only; "who
-- changed comp_amount_cents from $80k to $60k last March" has no
-- answer. When a contractor disputes a 1099 amount in February, this
-- is the paper trail that resolves it.
--
-- Two pieces:
--
-- 1. created_by_user_id / updated_by_user_id columns on the source
--    table itself, populated automatically from auth.uid() via
--    BEFORE INSERT/UPDATE trigger. Server actions don't need to
--    remember to set these.
--
-- 2. business_people_history table — captures the full row state
--    before every UPDATE and DELETE as JSONB. Append-only by
--    construction (no INSERT/UPDATE/DELETE policies; only the
--    SECURITY DEFINER trigger can write).
--
-- A history row is the "before" of a change. Pair it with the
-- current business_people row (or successor history rows) to
-- reconstruct the timeline.
--
-- Insert is intentionally not logged. The original row + its
-- created_at / created_by_user_id is the creation record; cluttering
-- history with "row was created" entries adds no information and
-- doubles write volume.

-- ============================================================
-- 1. Audit columns on business_people
-- ============================================================

ALTER TABLE public.business_people
  ADD COLUMN created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_business_people_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, auth.uid());
    NEW.updated_by_user_id := COALESCE(NEW.updated_by_user_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    -- Always refresh on UPDATE — explicit override would be unusual
    -- and the current actor is the right answer.
    NEW.updated_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_business_people_stamp_actor
  BEFORE INSERT OR UPDATE ON public.business_people
  FOR EACH ROW EXECUTE FUNCTION public.tg_business_people_stamp_actor();

-- ============================================================
-- 2. business_people_history (append-only)
-- ============================================================

CREATE TABLE public.business_people_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The original business_people.id this entry is about. NOT a foreign
  -- key — the whole point of history is to retain entries even after
  -- the source row is hard-deleted.
  business_person_id       UUID NOT NULL,
  -- Denormalized for RLS — the policy gates on business membership,
  -- which we can't derive from business_person_id alone after a
  -- delete.
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  operation                TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who triggered the change. Null only when the trigger ran outside
  -- a normal user context (service role, migration, etc.).
  changed_by_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Full pre-change row state. JSONB lets us add columns to
  -- business_people without history schema drift.
  previous_state           JSONB NOT NULL
);

CREATE INDEX idx_bph_business_person
  ON public.business_people_history (business_person_id, changed_at DESC);

CREATE INDEX idx_bph_business
  ON public.business_people_history (business_id, changed_at DESC);

-- The trigger function. SECURITY DEFINER so it bypasses the
-- history table's deny-all write policies — the only sanctioned
-- writer is the trigger itself.
CREATE OR REPLACE FUNCTION public.tg_business_people_log_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.business_people_history (
    business_person_id,
    business_id,
    operation,
    changed_by_user_id,
    previous_state
  ) VALUES (
    OLD.id,
    OLD.business_id,
    TG_OP,
    auth.uid(),
    to_jsonb(OLD)
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_business_people_log_change
  BEFORE UPDATE OR DELETE ON public.business_people
  FOR EACH ROW EXECUTE FUNCTION public.tg_business_people_log_change();

-- ============================================================
-- 3. RLS — read mirrors business_people, no direct writes
-- ============================================================

ALTER TABLE public.business_people_history ENABLE ROW LEVEL SECURITY;

-- Read access:
--   - owner/admin of the business → full history
--   - linked user (the person whose record this is) → only their own
CREATE POLICY "bph_select" ON public.business_people_history FOR SELECT
  USING (
    public.user_business_role(business_id) IN ('owner', 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.business_people bp
      WHERE bp.id = business_people_history.business_person_id
        AND bp.user_id = auth.uid()
    )
    OR EXISTS (
      -- Also expose history for rows that have already been deleted —
      -- the trigger captures user_id in previous_state, so a former
      -- linked user can still see their own history rows after the
      -- live record is gone.
      SELECT 1
      WHERE (business_people_history.previous_state->>'user_id')::UUID = auth.uid()
    )
  );

-- Append-only by construction. No INSERT / UPDATE / DELETE policies
-- exposed to authenticated users — only the SECURITY DEFINER trigger
-- can land rows. (RLS denies by default when no policy matches.)
