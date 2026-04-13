-- Error Logging & System Admin Infrastructure

-- ============================================================
-- 1. SYSTEM ADMINS
-- ============================================================

CREATE TABLE system_admins (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  granted_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System admins can view system_admins"
  ON system_admins FOR SELECT
  USING (EXISTS (SELECT 1 FROM system_admins sa WHERE sa.user_id = auth.uid()));

-- Insert/update/delete only via service role (no RLS policy for writes)

-- Helper function
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM system_admins WHERE user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Seed Marcus as first system admin
INSERT INTO system_admins (user_id)
VALUES ('912ff593-25c3-4d50-bbce-610b55225c5f')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. ERROR LOGS
-- ============================================================

CREATE TABLE error_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  error_code      TEXT NOT NULL,
  message         TEXT NOT NULL,
  user_message_key TEXT,
  details         JSONB DEFAULT '{}'::jsonb,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
  url             TEXT,
  action          TEXT,
  stack_trace     TEXT,
  severity        TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning', 'info')),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Only system admins can read error logs
CREATE POLICY "System admins can read error logs"
  ON error_logs FOR SELECT
  USING (public.is_system_admin());

-- Only system admins can update (resolve) error logs
CREATE POLICY "System admins can update error logs"
  ON error_logs FOR UPDATE
  USING (public.is_system_admin());

-- Insert is done via service role (logger bypasses RLS)

-- Indexes
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
CREATE INDEX idx_error_logs_error_code ON error_logs(error_code);
CREATE INDEX idx_error_logs_unresolved ON error_logs(resolved_at) WHERE resolved_at IS NULL;
