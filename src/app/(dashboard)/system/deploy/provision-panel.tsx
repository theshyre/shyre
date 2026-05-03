"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Webhook, RefreshCw } from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import {
  provisionEncryptionKeyAction,
  setEnvVarAction,
  triggerRedeployAction,
} from "./actions";

interface Props {
  encryptionKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
}

export function ProvisionPanel({
  encryptionKeyConfigured,
  webhookSecretConfigured,
}: Props): React.JSX.Element {
  const t = useTranslations("messaging.deploy");
  const toast = useToast();
  const [kekConfirm, setKekConfirm] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [, startKekTransition] = useTransition();
  const [, startWebhookTransition] = useTransition();
  const [, startRedeployTransition] = useTransition();
  const [kekPending, setKekPending] = useState(false);
  const [webhookPending, setWebhookPending] = useState(false);
  const [redeployPending, setRedeployPending] = useState(false);

  function onProvisionKey(): void {
    setKekPending(true);
    startKekTransition(async () => {
      try {
        const fd = new FormData();
        if (encryptionKeyConfigured) fd.set("confirm", kekConfirm);
        await assertActionResult(provisionEncryptionKeyAction(fd));
        toast.push({ kind: "success", message: t("provision.kekSent") });
        setKekConfirm("");
      } catch (err) {
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : t("provision.kekFailed"),
        });
      } finally {
        setKekPending(false);
      }
    });
  }

  function onSetWebhook(): void {
    if (!webhookSecret.trim()) return;
    setWebhookPending(true);
    startWebhookTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("key", "RESEND_WEBHOOK_SECRET");
        fd.set("value", webhookSecret.trim());
        await assertActionResult(setEnvVarAction(fd));
        toast.push({ kind: "success", message: t("provision.webhookSent") });
        setWebhookSecret("");
      } catch (err) {
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : t("provision.webhookFailed"),
        });
      } finally {
        setWebhookPending(false);
      }
    });
  }

  function onRedeploy(): void {
    setRedeployPending(true);
    startRedeployTransition(async () => {
      try {
        const fd = new FormData();
        await assertActionResult(triggerRedeployAction(fd));
        toast.push({ kind: "success", message: t("provision.redeployTriggered") });
      } catch (err) {
        toast.push({
          kind: "error",
          message:
            err instanceof Error ? err.message : t("provision.redeployFailed"),
        });
      } finally {
        setRedeployPending(false);
      }
    });
  }

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-accent" />
          <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("provision.kekHeading")}
          </h2>
        </div>
        <p className="mt-1 text-caption text-content-muted">
          {encryptionKeyConfigured
            ? t("provision.kekAlreadySet")
            : t("provision.kekIntro")}
        </p>

        {encryptionKeyConfigured && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft/30 p-3 space-y-2">
            <p className="text-body text-content">
              {t("provision.kekDangerHeading")}
            </p>
            <p className="text-caption text-content-muted">
              {t("provision.kekDangerDetail")}
            </p>
            <div>
              <label className={labelClass} htmlFor="kek_confirm">
                {t("provision.kekConfirmLabel")}
              </label>
              <input
                id="kek_confirm"
                value={kekConfirm}
                onChange={(e) => setKekConfirm(e.target.value)}
                placeholder="regenerate"
                className={`${inputClass} max-w-xs font-mono`}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onProvisionKey}
          disabled={
            kekPending ||
            (encryptionKeyConfigured && kekConfirm !== "regenerate")
          }
          className={`mt-3 ${buttonPrimaryClass}`}
        >
          <KeyRound size={14} />
          {kekPending
            ? t("provision.kekPending")
            : encryptionKeyConfigured
              ? t("provision.kekRotateButton")
              : t("provision.kekProvisionButton")}
        </button>
      </div>

      <div className="border-t border-edge pt-4">
        <div className="flex items-center gap-2">
          <Webhook size={16} className="text-accent" />
          <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("provision.webhookHeading")}
          </h2>
        </div>
        <p className="mt-1 text-caption text-content-muted">
          {webhookSecretConfigured
            ? t("provision.webhookAlreadySet")
            : t("provision.webhookIntro")}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] items-end">
          <div>
            <label className={labelClass} htmlFor="webhook_secret">
              {t("provision.webhookSecretLabel")}
            </label>
            <input
              id="webhook_secret"
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
              className={`${inputClass} font-mono`}
            />
          </div>
          <button
            type="button"
            onClick={onSetWebhook}
            disabled={webhookPending || !webhookSecret.trim()}
            className={buttonPrimaryClass}
          >
            <Webhook size={14} />
            {webhookPending
              ? t("provision.webhookPending")
              : t("provision.webhookSetButton")}
          </button>
        </div>
      </div>

      <div className="border-t border-edge pt-4">
        <p className="text-caption text-content-muted mb-2">
          {t("provision.redeployIntro")}
        </p>
        <button
          type="button"
          onClick={onRedeploy}
          disabled={redeployPending}
          className={buttonSecondaryClass}
        >
          <RefreshCw
            size={14}
            className={redeployPending ? "animate-spin" : ""}
          />
          {redeployPending
            ? t("provision.redeployPending")
            : t("provision.redeployButton")}
        </button>
      </div>
    </section>
  );
}
