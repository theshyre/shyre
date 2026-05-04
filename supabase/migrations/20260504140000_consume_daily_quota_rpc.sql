-- Atomic, recipient-aware daily-cap enforcement.
--
-- The Phase-1 implementation in rate-limit.ts had two issues
-- security-reviewer flagged (SAL-021):
--
--   1. Read-then-write race. Two concurrent sends both read
--      `sent=199, cap=200`, both update to 200, both proceed —
--      the cap is silently bypassed under load.
--
--   2. Each send counted as 1 regardless of recipient count.
--      A 5-recipient send + sendCopyToMe Cc burned 1 of 200 cap
--      slots while emitting 6 envelopes. Under-counts defeat the
--      abuse-defense purpose of the cap.
--
-- This RPC fixes both with a row-level lock + N-aware compare-and-
-- increment. SECURITY INVOKER so the caller's RLS still applies on
-- the read; FOR UPDATE serializes concurrent calls on the same
-- team's row.

CREATE OR REPLACE FUNCTION public.consume_daily_quota(
  p_team_id UUID,
  p_amount INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  cap INTEGER,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_cap INTEGER;
  v_sent INTEGER;
  v_window TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_window_size INTERVAL := INTERVAL '24 hours';
  v_window_expired BOOLEAN;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    -- Nothing to consume; treat as a no-op success so the caller
    -- doesn't have to special-case zero-recipient sends (they
    -- would already have failed earlier validation).
    RETURN QUERY SELECT TRUE, 0, 0, NULL::TEXT;
    RETURN;
  END IF;

  -- Lock the team's row so concurrent sends serialize.
  SELECT daily_cap, daily_sent_count, daily_window_starts_at
    INTO v_cap, v_sent, v_window
  FROM public.team_email_config
  WHERE team_id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'no_config'::TEXT;
    RETURN;
  END IF;

  v_window_expired := v_window IS NULL
    OR v_now - v_window >= v_window_size;

  IF v_window_expired THEN
    IF p_amount > v_cap THEN
      RETURN QUERY SELECT FALSE, v_cap, v_cap, 'cap_reached'::TEXT;
      RETURN;
    END IF;
    UPDATE public.team_email_config
      SET daily_sent_count = p_amount,
          daily_window_starts_at = v_now
      WHERE team_id = p_team_id;
    RETURN QUERY SELECT TRUE, v_cap - p_amount, v_cap, NULL::TEXT;
    RETURN;
  END IF;

  -- Same window. The cap check uses the post-increment count to
  -- catch the "would exceed cap if we accept" case in one branch.
  IF v_sent + p_amount > v_cap THEN
    RETURN QUERY SELECT
      FALSE, GREATEST(0, v_cap - v_sent), v_cap, 'cap_reached'::TEXT;
    RETURN;
  END IF;

  UPDATE public.team_email_config
    SET daily_sent_count = v_sent + p_amount
    WHERE team_id = p_team_id;
  RETURN QUERY SELECT
    TRUE, v_cap - (v_sent + p_amount), v_cap, NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION public.consume_daily_quota IS
  'Atomic daily-cap consume for the team_email_config row. Pass the envelope size (count of unique To+Cc+Bcc recipients) as p_amount. Returns one row: allowed (whether the send may proceed), remaining (slots left after this consume), cap (current daily_cap), reason (NULL on success, "cap_reached" or "no_config" otherwise). Atomic via FOR UPDATE so concurrent sends never bypass the cap.';
