"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertBanner } from "@theshyre/ui";
import { Mail, Send, KeyRound } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import {
  inputClass,
  textareaClass,
  labelClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import { updateEmailConfigAction } from "./actions";
import { sendTestEmailAction } from "./test-send-action";

interface Initial {
  fromEmail: string;
  fromName: string;
  replyToEmail: string;
  signature: string;
  dailyCap: number;
  hasApiKey: boolean;
  apiKeyExpiresAt: string;
}

interface Usage {
  dailySent: number;
  dailyCap: number;
}

export function EmailConfigForm({
  teamId,
  initial,
  usage,
}: {
  teamId: string;
  initial: Initial;
  usage: Usage;
}): React.JSX.Element {
  const t = useTranslations("messaging");
  const toast = useToast();
  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: updateEmailConfigAction,
  });
  const [testPending, setTestPending] = useState(false);

  async function onTestSend(): Promise<void> {
    setTestPending(true);
    try {
      const fd = new FormData();
      fd.set("team_id", teamId);
      await assertActionResult(sendTestEmailAction(fd));
      toast.push({ kind: "success", message: t("config.testSent") });
    } catch (err) {
      toast.push({
        kind: "error",
        message:
          err instanceof Error ? err.message : t("config.testSendFailed"),
      });
    } finally {
      setTestPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-accent" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("config.heading")}
        </h2>
      </div>

      <form action={handleSubmit} className="space-y-3">
        <input type="hidden" name="team_id" value={teamId} />

        {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

        <div>
          <label className={labelClass} htmlFor="api_key">
            {t("config.apiKey")}
          </label>
          <input
            id="api_key"
            name="api_key"
            type="password"
            autoComplete="off"
            placeholder={
              initial.hasApiKey
                ? t("config.apiKeyHasValuePlaceholder")
                : t("config.apiKeyPlaceholder")
            }
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("config.apiKeyHint")}
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="api_key_expires_at">
            {t("config.apiKeyExpiresAt")}
          </label>
          <input
            id="api_key_expires_at"
            name="api_key_expires_at"
            type="date"
            defaultValue={initial.apiKeyExpiresAt}
            className={`${inputClass} max-w-xs`}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("config.apiKeyExpiresAtHint")}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="from_email">
              {t("config.fromEmail")}
            </label>
            <input
              id="from_email"
              name="from_email"
              type="email"
              required
              defaultValue={initial.fromEmail}
              className={inputClass}
              placeholder="info@malcom.io"
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("config.fromEmailHint")}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="from_name">
              {t("config.fromName")}
            </label>
            <input
              id="from_name"
              name="from_name"
              defaultValue={initial.fromName}
              className={inputClass}
              placeholder="Malcom IO"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="reply_to_email">
              {t("config.replyToEmail")}
            </label>
            <input
              id="reply_to_email"
              name="reply_to_email"
              type="email"
              defaultValue={initial.replyToEmail}
              className={inputClass}
              placeholder="marcus@malcom.io"
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("config.replyToEmailHint")}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="daily_cap">
              {t("config.dailyCap")}
            </label>
            <input
              id="daily_cap"
              name="daily_cap"
              type="number"
              min={0}
              max={1000}
              defaultValue={initial.dailyCap}
              className={inputClass}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("config.dailyCapHint", {
                sent: usage.dailySent,
                cap: usage.dailyCap,
              })}
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="signature">
            {t("config.signature")}
          </label>
          <textarea
            id="signature"
            name="signature"
            rows={3}
            defaultValue={initial.signature}
            className={textareaClass}
            placeholder={t("config.signaturePlaceholder")}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("config.signatureHint")}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <SubmitButton
            label={t("config.save")}
            pending={pending}
            success={success}
            icon={Mail}
          />
          <Tooltip
            label={
              initial.hasApiKey
                ? t("config.testSendButton")
                : t("config.testSendNeedsKey")
            }
          >
            <button
              type="button"
              onClick={onTestSend}
              disabled={testPending || !initial.hasApiKey}
              className={buttonSecondaryClass}
              aria-label={
                initial.hasApiKey
                  ? t("config.testSendButton")
                  : t("config.testSendNeedsKey")
              }
            >
              <Send size={14} />
              {testPending ? t("config.testSending") : t("config.testSendButton")}
            </button>
          </Tooltip>
        </div>
      </form>
    </section>
  );
}
