-- SAL-024 + SAL-025: defense-in-depth against owner/admin forgery
-- of two messaging-platform fields the app code treats as authoritative.
--
-- 1. `verified_email_domains.status` — `assertFromDomainAllowed`
--    accepts any from-address whose domain has a row with
--    status='verified'. Without this lock, a team owner/admin can
--    UPDATE … status='verified' WHERE domain='victim.com' directly
--    via PostgREST and bypass SAL-016's domain-forgery defense.
--    Resend's own DNS check is still upstream, so practical risk is
--    medium — but the Shyre-side guarantee documented in SAL-016
--    must hold.
--
-- 2. `team_email_config.daily_sent_count` /
--    `team_email_config.daily_window_starts_at` — the consume_daily_quota
--    RPC is the only path that should write these. Without this lock,
--    an admin can UPDATE … daily_sent_count = 0 directly to reset and
--    burst past the cap.
--
-- Strategy for both: a BEFORE INSERT/UPDATE trigger that refuses
-- changes to the protected columns unless current_user is one of the
-- privileged roles (postgres / service_role). All legitimate writes
-- go through new SECURITY DEFINER RPCs that run as `postgres`.
--
-- consume_daily_quota is converted to SECURITY DEFINER and gains an
-- explicit team-membership check at the top so RLS bypass is safe.

-- ============================================================
-- 1. verified_email_domains — lock status forgery
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_verified_email_domains_lock_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Privileged roles (set by SECURITY DEFINER functions or by
  -- direct service-role connections) bypass the lock. Everyone
  -- else — including team owner/admin via PostgREST — must go
  -- through the upsert_email_domain_state_definer RPC.
  IF current_user IN ('postgres', 'service_role',
                      'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION
        'verified_email_domains: direct INSERT with status=% is not allowed. Call upsert_email_domain_state_definer instead.',
        NEW.status
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
    IF NEW.verified_at IS NOT NULL THEN
      RAISE EXCEPTION
        'verified_email_domains: direct INSERT cannot set verified_at.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'verified_email_domains: direct UPDATE of status is not allowed. Call upsert_email_domain_state_definer instead.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION
      'verified_email_domains: direct UPDATE of verified_at is not allowed.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.provider_domain_id IS DISTINCT FROM OLD.provider_domain_id THEN
    RAISE EXCEPTION
      'verified_email_domains: direct UPDATE of provider_domain_id is not allowed.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_verified_email_domains_lock_status
  ON public.verified_email_domains;
CREATE TRIGGER tg_verified_email_domains_lock_status
  BEFORE INSERT OR UPDATE ON public.verified_email_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_verified_email_domains_lock_status();

-- The privileged write path. Server actions (addEmailDomainAction /
-- verifyEmailDomainAction) call this after they've talked to the
-- provider and received an authoritative status. SECURITY DEFINER
-- so the underlying INSERT/UPDATE runs as `postgres` and the
-- trigger lets it through.
CREATE OR REPLACE FUNCTION public.upsert_email_domain_state_definer(
  p_team_id UUID,
  p_domain TEXT,
  p_provider_domain_id TEXT,
  p_status TEXT,
  p_dns_records JSONB,
  p_failure_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role TEXT;
  v_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- SECURITY DEFINER bypasses RLS, so we must validate the caller
  -- is an owner/admin of the target team explicitly.
  v_role := public.user_team_role(p_team_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION
      'upsert_email_domain_state_definer: caller is not an owner/admin of team %', p_team_id
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'verified', 'failed') THEN
    RAISE EXCEPTION
      'upsert_email_domain_state_definer: invalid status %', p_status
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  INSERT INTO public.verified_email_domains
    (team_id, domain, provider_domain_id, status, dns_records,
     verified_at, last_checked_at, failure_reason)
  VALUES
    (p_team_id, p_domain, p_provider_domain_id, p_status, p_dns_records,
     CASE WHEN p_status = 'verified' THEN v_now ELSE NULL END,
     v_now, p_failure_reason)
  ON CONFLICT (team_id, domain) DO UPDATE
    SET provider_domain_id = EXCLUDED.provider_domain_id,
        status = EXCLUDED.status,
        dns_records = EXCLUDED.dns_records,
        verified_at = EXCLUDED.verified_at,
        last_checked_at = EXCLUDED.last_checked_at,
        failure_reason = EXCLUDED.failure_reason
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_email_domain_state_definer
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_email_domain_state_definer
  TO authenticated;

COMMENT ON FUNCTION public.upsert_email_domain_state_definer IS
  'Privileged write path for verified_email_domains. Direct PostgREST INSERT/UPDATE of (status, verified_at, provider_domain_id) is refused by the lock trigger; this function (SECURITY DEFINER, owner/admin gated) is the only legitimate writer. SAL-024.';

-- Refresh-only path: when a provider status check returns the same
-- status, we still want to update last_checked_at. Allowed without
-- the RPC because it's a benign no-op write, but only for the
-- caller's team rows. The lock trigger lets it through because
-- last_checked_at isn't in the protected set.
-- (No code change needed for that.)


-- ============================================================
-- 2. team_email_config — lock daily-cap counter
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_team_email_config_lock_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role',
                      'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- INSERT comes from updateEmailConfigAction's upsert. The
    -- defaults (0, now()) are already correct; refuse if the
    -- caller is trying to seed a non-default value.
    IF NEW.daily_sent_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'team_email_config: direct INSERT cannot set daily_sent_count.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.daily_sent_count IS DISTINCT FROM OLD.daily_sent_count THEN
    RAISE EXCEPTION
      'team_email_config: direct UPDATE of daily_sent_count is not allowed. The consume_daily_quota RPC is the only writer.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.daily_window_starts_at IS DISTINCT FROM OLD.daily_window_starts_at THEN
    RAISE EXCEPTION
      'team_email_config: direct UPDATE of daily_window_starts_at is not allowed.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_team_email_config_lock_quota
  ON public.team_email_config;
CREATE TRIGGER tg_team_email_config_lock_quota
  BEFORE INSERT OR UPDATE ON public.team_email_config
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_team_email_config_lock_quota();

-- Convert consume_daily_quota to SECURITY DEFINER so its UPDATE
-- runs as `postgres` and the trigger lets it through. Add an
-- explicit team-membership check up top because SECURITY DEFINER
-- bypasses RLS on the team_email_config row read.
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
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role TEXT;
  v_cap INTEGER;
  v_sent INTEGER;
  v_window TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_window_size INTERVAL := INTERVAL '24 hours';
  v_window_expired BOOLEAN;
BEGIN
  -- SECURITY DEFINER bypasses RLS; explicit membership check.
  -- The send pipeline runs from a server action that has already
  -- validated owner/admin role; this is defense in depth.
  v_role := public.user_team_role(p_team_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION
      'consume_daily_quota: caller is not an owner/admin of team %', p_team_id
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT TRUE, 0, 0, NULL::TEXT;
    RETURN;
  END IF;

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

REVOKE ALL ON FUNCTION public.consume_daily_quota FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_daily_quota TO authenticated;

COMMENT ON FUNCTION public.consume_daily_quota IS
  'Atomic daily-cap consume for the team_email_config row. SECURITY DEFINER with explicit owner/admin membership check — direct UPDATE of daily_sent_count is locked by trigger. SAL-021 + SAL-025.';
