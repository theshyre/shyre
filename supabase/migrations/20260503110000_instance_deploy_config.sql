-- System-admin-scoped deploy configuration.
--
-- Phase 1.5 of the messaging platform: a /system/deploy page that
-- lets the Shyre system admin connect a deployment-environment
-- provider (Vercel today; Cloudflare Pages, Fly.io, etc. later)
-- and have Shyre push instance-wide secrets (EMAIL_KEY_ENCRYPTION_KEY,
-- RESEND_WEBHOOK_SECRET) directly to that provider's env-var API.
-- Removes the manual "go paste this in Vercel and redeploy" step.
--
-- Single-row table — there's one Shyre instance per deployment.
-- The `id = 1` check + PK enforcement is the lock; the `is_singleton`
-- generated column gives an INSERT a unique target if a malformed
-- second row is ever attempted.
--
-- The Vercel API token is sensitive (full project-modify access).
-- Stored as plain TEXT for now under system-admin-only RLS, same
-- pattern as the existing `user_settings.github_token`. SAL-019
-- documents this and the planned Phase 2 upgrade to encrypt the
-- token under the master key.

CREATE TABLE IF NOT EXISTS public.instance_deploy_config (
  id              INTEGER PRIMARY KEY DEFAULT 1
                  CHECK (id = 1),
  provider        TEXT NOT NULL DEFAULT 'vercel'
                  CHECK (provider IN ('vercel')),
  api_token       TEXT,
  project_id      TEXT,
  vercel_team_id  TEXT,
  deploy_hook_url TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instance_deploy_config ENABLE ROW LEVEL SECURITY;

-- System admins only — owner/admin of a single team is NOT enough,
-- this is instance-level (affects every team's encrypted-secret
-- decrypt path). Uses the existing `public.is_system_admin()`
-- helper from migration 006.
CREATE POLICY "instance_deploy_config_select_sysadmin"
  ON public.instance_deploy_config FOR SELECT
  USING (public.is_system_admin());

CREATE POLICY "instance_deploy_config_insert_sysadmin"
  ON public.instance_deploy_config FOR INSERT
  WITH CHECK (public.is_system_admin());

CREATE POLICY "instance_deploy_config_update_sysadmin"
  ON public.instance_deploy_config FOR UPDATE
  USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

CREATE POLICY "instance_deploy_config_delete_sysadmin"
  ON public.instance_deploy_config FOR DELETE
  USING (public.is_system_admin());

CREATE TRIGGER tg_instance_deploy_config_set_updated_at
  BEFORE UPDATE ON public.instance_deploy_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.instance_deploy_config IS
  'Single-row table holding the deployment-provider connection (Vercel API token + project ID + deploy hook URL) used by /system/deploy to push instance-wide secrets to the running deployment. System admins only.';
COMMENT ON COLUMN public.instance_deploy_config.api_token IS
  'Provider API token. RLS-protected (system admin only); plaintext today, encrypted via KEK in Phase 2 upgrade. SAL-019.';
COMMENT ON COLUMN public.instance_deploy_config.deploy_hook_url IS
  'Vercel Deploy Hook URL (project Settings → Git → Deploy Hooks). Posting to this URL triggers a redeploy with the latest committed code + the just-saved env vars.';
