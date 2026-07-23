"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Mail, ShieldCheck } from "lucide-react";

import { inputClass, buttonPrimaryClass, buttonSecondaryClass } from "@/lib/form-styles";
import { AlertBanner } from "@theshyre/ui";
import type { SignGateInfo } from "@/lib/sign/signoff-sign-service";
import {
  requestSignoffOtpAction,
  verifySignoffOtpAction,
} from "./actions";

/** The identity gate: no document is shown until an emailed one-time code is
 *  verified (SAL-045). A forwarded link (no cookie) stays here. */
export function SignoffSignGate({
  token,
  info,
}: {
  token: string;
  info: SignGateInfo;
}): React.JSX.Element {
  const t = useTranslations("signoff.sign");
  const router = useRouter();
  const [step, setStep] = useState<"start" | "code">(info.otpPending ? "code" : "start");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const brand = info.businessName ?? info.wordmarkPrimary ?? "";

  function reason(r?: string): string {
    if (r === "otp_locked") return t("otpLocked");
    if (r === "otp_expired") return t("otpExpired");
    if (r === "otp_cooldown") return t("otpCooldown");
    if (r === "email_failed") return t("emailFailed");
    if (r === "otp_invalid") return t("otpInvalid");
    return t("genericError");
  }

  function sendCode(): void {
    setError(null);
    startTransition(async () => {
      const res = await requestSignoffOtpAction(token);
      if (res.ok) setStep("code");
      else setError(reason(res.reason));
    });
  }

  function verify(): void {
    setError(null);
    startTransition(async () => {
      const res = await verifySignoffOtpAction(token, code);
      if (res.ok) router.refresh();
      else setError(reason(res.reason));
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[440px] flex-col justify-center gap-5 px-[24px] py-10">
      {brand && (
        <div className="text-center text-body-lg font-semibold text-content">{brand}</div>
      )}

      {info.decided ? (
        <div className="rounded-lg border border-edge bg-surface-raised px-5 py-6 text-center">
          <ShieldCheck size={28} className="mx-auto mb-2 text-success-text" aria-hidden="true" />
          <p className="text-body text-content">{t("alreadyDecided")}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-edge bg-surface-raised px-5 py-6">
          <h1 className="text-title font-semibold text-content">{t("gateHeading")}</h1>
          <p className="mt-1 text-body text-content-secondary">
            {t("gateBody", { email: info.maskedEmail })}
          </p>

          {error && (
            <div className="mt-3">
              <AlertBanner tone="error">{error}</AlertBanner>
            </div>
          )}

          {step === "start" ? (
            <button
              type="button"
              className={`${buttonPrimaryClass} mt-4 w-full justify-center`}
              onClick={sendCode}
              disabled={pending}
            >
              <Mail size={16} />
              {t("emailCode")}
            </button>
          ) : (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pending && /^\d{6}$/.test(code)) verify();
              }}
            >
              <label htmlFor="signoff-otp" className="block text-body font-medium text-content">
                {t("codeLabel")}
              </label>
              <input
                id="signoff-otp"
                className={`${inputClass} text-center text-title tracking-[0.4em]`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
              />
              <button
                type="submit"
                className={`${buttonPrimaryClass} w-full justify-center`}
                disabled={pending || !/^\d{6}$/.test(code)}
              >
                {t("verify")}
              </button>
              <button
                type="button"
                className={`${buttonSecondaryClass} w-full justify-center`}
                onClick={sendCode}
                disabled={pending}
              >
                {t("resendCode")}
              </button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
