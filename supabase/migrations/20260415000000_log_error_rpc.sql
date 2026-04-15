-- Fallback path for the error logger.
--
-- Today, error_logs has no INSERT policy, so only the service role can write
-- rows. That means logError() depends on SUPABASE_SERVICE_ROLE_KEY being set
-- in every environment — and if the env var is ever missing (e.g. not
-- configured in Vercel), every server-side error goes unrecorded.
--
-- This RPC lets any authenticated user append a single error row with
-- elevated privileges (SECURITY DEFINER) while the client-caller context is
-- preserved via auth.uid(). The caller's identity is used as user_id, so
-- users can't forge entries on behalf of other users.
--
-- Anonymous callers are rejected to prevent log-spamming.

CREATE OR REPLACE FUNCTION public.log_error_from_user(
  p_error_code text,
  p_message text,
  p_user_message_key text DEFAULT NULL,
  p_details jsonb DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_stack_trace text DEFAULT NULL,
  p_severity text DEFAULT 'error'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid uuid := auth.uid();
  new_id uuid;
BEGIN
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'log_error_from_user requires authentication'
      USING ERRCODE = '42501';
  END IF;

  IF p_severity NOT IN ('error', 'warning', 'info') THEN
    p_severity := 'error';
  END IF;

  INSERT INTO public.error_logs (
    error_code,
    message,
    user_message_key,
    details,
    user_id,
    url,
    action,
    stack_trace,
    severity
  )
  VALUES (
    COALESCE(NULLIF(p_error_code, ''), 'UNKNOWN'),
    COALESCE(p_message, ''),
    p_user_message_key,
    COALESCE(p_details, '{}'::jsonb),
    caller_uid,
    p_url,
    p_action,
    p_stack_trace,
    p_severity
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Grant execution to authenticated users. Anon is intentionally excluded.
REVOKE ALL ON FUNCTION public.log_error_from_user(text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_error_from_user(text, text, text, jsonb, text, text, text, text) TO authenticated;
