-- Drop legacy state-identity fields from businesses.
--
-- Follow-up to the business/team split (20260420170000–002). Those
-- migrations kept `businesses.registered_state` and
-- `businesses.state_registration_id` alongside the new
-- `business_state_registrations` table to give the backfill somewhere
-- to land. Keeping them permanently duplicates state-level data that
-- belongs on the formation row (`is_formation = true`) — the Identity
-- form would show "Registered in: DE" + "State registration ID: 123"
-- while the State registrations section showed the same DE row with
-- its own entity_number. Single source of truth: the formation row.
--
-- Defensive backfill before the drop: if any business has a non-blank
-- `registered_state` or `state_registration_id` and no formation row,
-- promote the value into a new formation row. Skipped if the business
-- already has a formation row (in which case the duplicate field was
-- always the stale copy).

DO $$
DECLARE
  r RECORD;
  st TEXT;
BEGIN
  FOR r IN
    SELECT id, registered_state, state_registration_id
      FROM public.businesses b
     WHERE (
             (b.registered_state IS NOT NULL AND length(trim(b.registered_state)) > 0)
             OR (b.state_registration_id IS NOT NULL AND length(trim(b.state_registration_id)) > 0)
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.business_state_registrations bsr
              WHERE bsr.business_id = b.id AND bsr.is_formation = true
           )
  LOOP
    -- Only promote if the legacy registered_state is already a clean
    -- 2-letter code. Anything else (e.g. "Delaware" spelled out) was
    -- never a valid state code; skip it and let the user re-enter.
    IF r.registered_state IS NOT NULL
       AND upper(trim(r.registered_state)) ~ '^[A-Z]{2}$' THEN
      st := upper(trim(r.registered_state));
      INSERT INTO public.business_state_registrations (
        business_id,
        state,
        is_formation,
        registration_type,
        entity_number,
        registration_status
      ) VALUES (
        r.id,
        st,
        true,
        'domestic',
        NULLIF(trim(coalesce(r.state_registration_id, '')), ''),
        'active'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.businesses
  DROP COLUMN registered_state,
  DROP COLUMN state_registration_id;
