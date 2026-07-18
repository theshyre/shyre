"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock, ShieldCheck, CircleAlert } from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import type { SignGateInfo } from "@/lib/proposals/sign-service";
import {
  requestSignOtpAction,
  verifySignOtpAction,
  type PublicActionResult,
} from "./actions";
import { signFailureKey } from "@/lib/proposals/sign-failure";

interface Props {
  token: string;
  info: SignGateInfo;
}

/**
 * The identity gate (SAL-045). Rendered instead of the proposal whenever the
 * browser has no verified view session. It shows ONLY the sender's brand + a
 * masked recipient and the emailed-code flow — no pricing, scope, or title
 * reaches a forwarded-link holder. On a successful verify the action sets the
 * view-session cookie and `router.refresh()` re-renders the page, which now
 * loads the full document.
 *
 * Deliberately mirrors the sign-experience OTP idiom (single forward action →
 * primary; a persistent polite live region; code field auto-focus) so a signer
 * sees one consistent verification pattern.
 */
export function SignGate({ token, info }: Props): React.JSX.Element {
  const t = useTranslations("proposals.sign");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [otpRequested, setOtpRequested] = useState(info.otpPending);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "otp_send" | "otp_verify" | null
  >(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // When the code field appears (after "Email me a code"), move the caret in.
  const prevRequested = useRef(otpRequested);
  useEffect(() => {
    if (!prevRequested.current && otpRequested) otpInputRef.current?.focus();
    prevRequested.current = otpRequested;
  }, [otpRequested]);

  function failureMessage(result: PublicActionResult): string {
    return t(signFailureKey(result.reason));
  }

  function runAction(
    action: "otp_send" | "otp_verify",
    fn: () => Promise<PublicActionResult>,
    onOk?: () => void,
    announce?: string,
  ): void {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      const result = await fn();
      setPendingAction(null);
      if (result.ok) {
        onOk?.();
        if (announce) setAnnouncement(announce);
        // Verify sets the view-session cookie server-side; refresh re-renders
        // the page, which now clears the gate and loads the document.
        router.refresh();
      } else {
        setError(failureMessage(result));
      }
    });
  }

  return (
    <main className="mx-auto max-w-[480px] px-[24px] py-[40px]">
      {/* Persistent polite live region — announces code-sent / verified. */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>

      {/* Sender brand lockup — the only thing a forwarded-link holder sees.
          Decorative; the business name is restated in the copy below. */}
      {(info.businessLogoUrl || info.wordmarkPrimary) && (
        <div className="mb-6 flex items-center gap-3">
          {info.businessLogoUrl ? (
            // Public Supabase URL on a login-free page; plain <img> per the
            // avatar precedent.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={info.businessLogoUrl}
              alt=""
              aria-hidden="true"
              className="max-h-[48px] w-auto object-contain"
            />
          ) : null}
          {info.wordmarkPrimary ? (
            <p aria-hidden="true" className="text-title font-semibold">
              <span style={{ color: info.brandColor ?? undefined }}>
                {info.wordmarkPrimary}
              </span>
              {info.wordmarkSecondary ? (
                <span className="text-content">{info.wordmarkSecondary}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      )}

      <div className="rounded-lg border border-edge bg-surface-raised p-5">
        <h1 className="flex items-center gap-2 text-title font-semibold text-content">
          <Lock size={18} aria-hidden="true" className="text-accent" />
          {t("otpHeading")}
        </h1>

        {info.decided ? (
          <p className="mt-2 text-body text-content-secondary">
            {t("gateDecided", { business: info.businessName ?? "—" })}
          </p>
        ) : (
          <>
            <p className="mt-2 text-body text-content-secondary">
              {t("gateWaiting", { business: info.businessName ?? "—" })}
            </p>
            <p className="mt-1 text-body text-content-secondary">
              {t("gateHint", { email: info.maskedEmail })}
            </p>

            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (otpRequested && otpCode.length === 6) {
                  runAction("otp_verify", () =>
                    verifySignOtpAction(token, otpCode),
                  );
                } else if (!otpRequested) {
                  runAction(
                    "otp_send",
                    () => requestSignOtpAction(token),
                    () => setOtpRequested(true),
                    t("announceCodeSent"),
                  );
                }
              }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <button
                  type={otpRequested ? "button" : "submit"}
                  className={
                    otpRequested ? buttonSecondaryClass : buttonPrimaryClass
                  }
                  disabled={pending}
                  onClick={
                    otpRequested
                      ? () =>
                          runAction(
                            "otp_send",
                            () => requestSignOtpAction(token),
                            undefined,
                            t("announceCodeSent"),
                          )
                      : undefined
                  }
                >
                  {pendingAction === "otp_send"
                    ? t("otpSending")
                    : otpRequested
                      ? t("otpResend")
                      : t("otpSend")}
                </button>
                {otpRequested && (
                  <>
                    <div>
                      <label htmlFor="gate-otp" className={labelClass}>
                        {t("otpLabel")}
                      </label>
                      <input
                        id="gate-otp"
                        ref={otpInputRef}
                        className={`${inputClass} w-[140px] font-mono tracking-widest`}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) =>
                          setOtpCode(e.target.value.replace(/\D/g, ""))
                        }
                      />
                    </div>
                    <button
                      type="submit"
                      className={buttonPrimaryClass}
                      disabled={pending || otpCode.length !== 6}
                    >
                      <ShieldCheck size={16} aria-hidden="true" />
                      {pendingAction === "otp_verify"
                        ? t("otpVerifying")
                        : t("otpVerify")}
                    </button>
                  </>
                )}
              </div>
            </form>

            {error && (
              <p
                role="alert"
                className="mt-3 flex items-center gap-1.5 text-body text-error"
              >
                <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
