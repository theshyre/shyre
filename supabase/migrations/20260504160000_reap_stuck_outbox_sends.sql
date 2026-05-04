-- Reap rows stuck in 'sending'.
--
-- The drain path flips status='sending' BEFORE calling the provider,
-- then flips again to 'sent' / 'failed_*' based on the result. If
-- the process dies between those two writes (Vercel function timeout,
-- crash, redeploy in flight), the row sits in 'sending' forever
-- with no retry path. The user-facing symptom: the invoice is
-- marked sent but no outbox row signals delivery; the activity
-- log shows nothing flipping past "sending."
--
-- This function detects rows in `sending` whose `updated_at` is
-- older than the cutoff and flips them to `failed_retryable` so
-- a future drainer (or a manual re-send) can pick them up.
-- Caller passes the cutoff (default 5 minutes) — short enough to
-- catch hangs quickly, long enough that a healthy 30s send isn't
-- preempted.
--
-- SECURITY DEFINER so a future cron job running under a limited
-- role can call it without write access on message_outbox.

CREATE OR REPLACE FUNCTION public.reap_stuck_outbox_sends(
  p_cutoff_minutes INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reaped INTEGER;
BEGIN
  IF p_cutoff_minutes IS NULL OR p_cutoff_minutes < 1 THEN
    RAISE EXCEPTION 'reap_stuck_outbox_sends: cutoff must be >= 1 minute';
  END IF;

  WITH stuck AS (
    SELECT id FROM public.message_outbox
    WHERE status = 'sending'
      AND updated_at < now() - make_interval(mins => p_cutoff_minutes)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.message_outbox AS mo
  SET
    status = 'failed_retryable',
    error_message = COALESCE(error_message, '')
      || CASE WHEN error_message IS NULL OR error_message = '' THEN '' ELSE E'\n' END
      || 'Reaped: stuck in sending past cutoff'
  FROM stuck
  WHERE mo.id = stuck.id;

  GET DIAGNOSTICS v_reaped = ROW_COUNT;
  RETURN v_reaped;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_outbox_sends(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stuck_outbox_sends(INTEGER) TO service_role;

COMMENT ON FUNCTION public.reap_stuck_outbox_sends IS
  'Flip rows stuck in status=sending past p_cutoff_minutes (default 5) to failed_retryable. Returns count reaped. Designed for cron / scheduled invocation; service_role only.';
