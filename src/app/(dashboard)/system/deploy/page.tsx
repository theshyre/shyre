import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { Cloud, Check, AlertCircle, ExternalLink } from "lucide-react";
import { DeployConnectionForm } from "./connection-form";
import { ProvisionPanel } from "./provision-panel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("messaging.deploy");
  return { title: t("title") };
}

/**
 * /system/deploy — system admin only (gated by /system layout).
 *
 * Three sections:
 *   1. Connection — paste Vercel API token + project ID + (optional)
 *      Vercel team ID + deploy hook URL.
 *   2. Provision — generate EMAIL_KEY_ENCRYPTION_KEY, paste
 *      RESEND_WEBHOOK_SECRET, push both to Vercel + trigger
 *      redeploy.
 *   3. Status — what's currently set in the running deployment's
 *      env (detected via process.env at request time).
 */
export default async function SystemDeployPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("messaging.deploy");

  const { data: cfg } = await supabase
    .from("instance_deploy_config")
    .select(
      "provider, api_token, project_id, vercel_team_id, deploy_hook_url, last_synced_at",
    )
    .eq("id", 1)
    .maybeSingle();

  const connected = Boolean(cfg?.api_token && cfg?.project_id);
  const encryptionKeyConfigured = Boolean(process.env.EMAIL_KEY_ENCRYPTION_KEY);
  const webhookSecretConfigured = Boolean(process.env.RESEND_WEBHOOK_SECRET);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Cloud size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">
          {t("title")}
        </h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        {t("intro")}
      </p>

      {/* Status snapshot */}
      <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-2">
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("statusHeading")}
        </h2>
        <ul className="space-y-1.5 text-body">
          <StatusRow ok={connected} label={t("statusVercelConnected")} />
          <StatusRow
            ok={encryptionKeyConfigured}
            label={t("statusEncryptionKey")}
          />
          <StatusRow
            ok={webhookSecretConfigured}
            label={t("statusWebhookSecret")}
          />
        </ul>
        {cfg?.last_synced_at && (
          <p className="text-caption text-content-muted">
            {t("lastSynced", {
              when: new Date(cfg.last_synced_at as string).toLocaleString(),
            })}
          </p>
        )}
        <p className="text-caption text-content-muted pt-1">
          <Link
            href="/docs/guides/admin/email-setup"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            {t("docsLink")}
            <ExternalLink size={11} />
          </Link>
        </p>
      </section>

      <DeployConnectionForm
        initial={{
          apiTokenSet: Boolean(cfg?.api_token),
          projectId: (cfg?.project_id as string | null) ?? "",
          vercelTeamId: (cfg?.vercel_team_id as string | null) ?? "",
          deployHookUrl: (cfg?.deploy_hook_url as string | null) ?? "",
        }}
      />

      {connected && (
        <ProvisionPanel
          encryptionKeyConfigured={encryptionKeyConfigured}
          webhookSecretConfigured={webhookSecretConfigured}
        />
      )}
    </div>
  );
}

function StatusRow({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-success">
          <Check size={12} aria-hidden />
        </span>
      ) : (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning-soft text-warning">
          <AlertCircle size={12} aria-hidden />
        </span>
      )}
      <span className={ok ? "text-content" : "text-content-secondary"}>
        {label}
      </span>
    </li>
  );
}
