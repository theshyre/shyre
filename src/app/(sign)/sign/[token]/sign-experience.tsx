"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  XCircle,
  MailCheck,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { roundMoney } from "@/lib/proposals/line-items";
import type { SignBundle } from "@/lib/proposals/sign-service";
import {
  requestSignOtpAction,
  verifySignOtpAction,
  submitSignDecisionAction,
  type PublicActionResult,
} from "./actions";

interface Props {
  token: string;
  bundle: SignBundle;
}

/**
 * The client-side sign-off flow: review the document → request + enter the
 * emailed one-time code → select the line items to authorize → typed-name
 * signature → accept (or decline). Every submit re-validates server-side;
 * this component only drives UI state.
 */
export function SignExperience({ token, bundle }: Props): React.JSX.Element {
  const t = useTranslations("proposals.sign");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [otpRequested, setOtpRequested] = useState(bundle.otpPending);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(bundle.items.map((item) => item.id)),
  );
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [signature, setSignature] = useState("");
  const [confirmDecline, setConfirmDecline] = useState(false);

  const selectedTotal = useMemo(
    () =>
      roundMoney(
        bundle.items
          .filter((item) => selected.has(item.id))
          .reduce((sum, item) => sum + item.fixedPrice, 0),
      ),
    [bundle.items, selected],
  );
  const fullTotal = roundMoney(
    bundle.items.reduce((sum, item) => sum + item.fixedPrice, 0),
  );
  const currency = bundle.proposal.currency;

  /** Map a coarse failure reason onto a translated message. */
  function failureMessage(result: PublicActionResult): string {
    switch (result.reason) {
      case "otp_invalid":
        return t("errors.otpInvalid");
      case "otp_expired":
        return t("errors.otpExpired");
      case "otp_locked":
        return t("errors.otpLocked");
      case "otp_cooldown":
        return t("errors.otpCooldown");
      case "otp_required":
        return t("errors.otpRequired");
      case "consumed":
        return t("errors.consumed");
      case "invalid_selection":
        return t("errors.invalidSelection");
      case "email_failed":
        return t("errors.emailFailed");
      default:
        return t("errors.generic");
    }
  }

  function runAction(fn: () => Promise<PublicActionResult>, onOk?: () => void): void {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(failureMessage(result));
      }
    });
  }

  const decided = bundle.decided;
  const decidedAccepted = bundle.proposal.status === "accepted";

  return (
    <main className="mx-auto max-w-[720px] px-[24px] py-[40px]">
      {/* Document header */}
      <p className="text-caption uppercase tracking-wide text-content-muted">
        {t("heading", { business: bundle.businessName ?? "—" })}
      </p>
      <h1 className="mt-1 text-title font-semibold text-content">
        {bundle.proposal.title}
      </h1>
      <p className="mt-1 font-mono text-caption text-content-secondary">
        {bundle.proposal.proposalNumber}
        {bundle.proposal.validUntil
          ? ` · ${t("validUntil", { date: bundle.proposal.validUntil })}`
          : ""}
      </p>

      {/* Decision banner (terminal states) */}
      {decided && (
        <div
          role="status"
          className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-body ${
            decidedAccepted
              ? "border-success-text bg-success-soft text-success-text"
              : "border-edge bg-surface-inset text-content-secondary"
          }`}
        >
          {decidedAccepted ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <XCircle size={16} aria-hidden="true" />
          )}
          {decidedAccepted
            ? t("alreadyAccepted", {
                total: formatCurrency(
                  bundle.proposal.acceptedTotal ?? fullTotal,
                  currency,
                ),
              })
            : t("alreadyDecided")}
        </div>
      )}

      {/* Line items — selectable when signing is possible */}
      <section className="mt-[24px]">
        <h2 className="text-heading font-semibold text-content">
          {t("itemsHeading")}
        </h2>
        {!decided && bundle.otpVerified && (
          <p className="mt-1 text-caption text-content-secondary">
            {t("itemsHint")}
          </p>
        )}
        <div className="mt-3 space-y-[12px]">
          {bundle.items.map((item) => (
            <label
              key={item.id}
              className={`block rounded-lg border p-4 ${
                !decided && bundle.otpVerified
                  ? "cursor-pointer border-edge hover:bg-hover"
                  : "border-edge"
              } ${selected.has(item.id) && bundle.otpVerified && !decided ? "bg-accent-soft/30" : ""}`}
            >
              <div className="flex items-start gap-3">
                {!decided && bundle.otpVerified && (
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(item.id)}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-body-lg font-semibold text-content">
                      {item.title}
                    </span>
                    <span className="font-mono text-body-lg text-content">
                      {formatCurrency(item.fixedPrice, currency)}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1 text-body text-content-secondary">
                      {item.description}
                    </p>
                  )}
                  {item.whyItMatters && (
                    <p className="mt-1 text-caption text-content-secondary">
                      <span className="font-semibold">{t("whyItMatters")}: </span>
                      {item.whyItMatters}
                    </p>
                  )}
                  {item.outOfScope && (
                    <p className="mt-1 text-caption text-content-secondary">
                      <span className="font-semibold">{t("outOfScope")}: </span>
                      {item.outOfScope}
                    </p>
                  )}
                  {item.definitionOfDone && (
                    <p className="mt-1 text-caption text-content-secondary">
                      <span className="font-semibold">
                        {t("definitionOfDone")}:{" "}
                      </span>
                      {item.definitionOfDone}
                    </p>
                  )}
                  {item.phases.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-edge pt-2">
                      {item.phases.map((phase, j) => (
                        <li
                          key={j}
                          className="flex justify-between pl-[12px] text-caption text-content-secondary"
                        >
                          <span>{phase.title}</span>
                          <span className="font-mono">
                            {formatCurrency(phase.fixedPrice, currency)}
                          </span>
                        </li>
                      ))}
                      {item.isCapped && (
                        <li className="pl-[12px] text-label text-content-muted">
                          {t("capped", {
                            total: formatCurrency(item.fixedPrice, currency),
                          })}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between border-t border-edge pt-2">
          <span className="text-body-lg font-semibold text-content">
            {bundle.otpVerified && !decided
              ? t("selectedTotal")
              : t("fullTotal")}
          </span>
          <span className="font-mono text-title font-semibold text-content">
            {formatCurrency(
              bundle.otpVerified && !decided ? selectedTotal : fullTotal,
              currency,
            )}
          </span>
        </div>
      </section>

      {/* Terms */}
      {(bundle.proposal.paymentTermsLabel ||
        bundle.proposal.depositType !== "none" ||
        bundle.proposal.warrantyDays != null ||
        bundle.proposal.termsNotes) && (
        <section className="mt-[24px]">
          <h2 className="text-heading font-semibold text-content">
            {t("termsHeading")}
          </h2>
          <ul className="mt-2 space-y-1 text-body text-content-secondary">
            {bundle.proposal.paymentTermsLabel && (
              <li>
                {t("paymentTerms")}: {bundle.proposal.paymentTermsLabel}
              </li>
            )}
            {bundle.proposal.depositType === "percent" &&
              bundle.proposal.depositValue != null && (
                <li>
                  {t("deposit")}:{" "}
                  {t("depositPercent", { value: bundle.proposal.depositValue })}
                </li>
              )}
            {bundle.proposal.depositType === "amount" &&
              bundle.proposal.depositValue != null && (
                <li>
                  {t("deposit")}:{" "}
                  {formatCurrency(bundle.proposal.depositValue, currency)}
                </li>
              )}
            {bundle.proposal.warrantyDays != null && (
              <li>
                {t("warranty")}:{" "}
                {t("warrantyDays", { days: bundle.proposal.warrantyDays })}
              </li>
            )}
          </ul>
          {bundle.proposal.termsNotes && (
            <p className="mt-2 whitespace-pre-wrap text-body text-content-secondary">
              {bundle.proposal.termsNotes}
            </p>
          )}
        </section>
      )}

      {/* Sign-off flow */}
      {!decided && (
        <section className="mt-[32px] rounded-lg border border-edge bg-surface-raised p-4">
          {!bundle.otpVerified ? (
            <>
              <h2 className="flex items-center gap-2 text-body-lg font-semibold text-content">
                <MailCheck size={16} aria-hidden="true" />
                {t("otpHeading")}
              </h2>
              <p className="mt-1 text-body text-content-secondary">
                {t("otpHint", { email: bundle.signerEmail })}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      () => requestSignOtpAction(token),
                      () => setOtpRequested(true),
                    )
                  }
                >
                  {otpRequested ? t("otpResend") : t("otpSend")}
                </button>
                {otpRequested && (
                  <>
                    <div>
                      <label htmlFor="sign-otp" className={labelClass}>
                        {t("otpLabel")}
                      </label>
                      <input
                        id="sign-otp"
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
                      type="button"
                      className={buttonPrimaryClass}
                      disabled={pending || otpCode.length !== 6}
                      onClick={() =>
                        runAction(() => verifySignOtpAction(token, otpCode))
                      }
                    >
                      <ShieldCheck size={16} aria-hidden="true" />
                      {t("otpVerify")}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="flex items-center gap-2 text-body-lg font-semibold text-content">
                <ShieldCheck size={16} aria-hidden="true" />
                {t("signHeading")}
              </h2>
              <p className="mt-1 text-body text-content-secondary">
                {t("signHint")}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="sign-name" className={labelClass}>
                    {t("signerName")}
                  </label>
                  <input
                    id="sign-name"
                    className={inputClass}
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="sign-title" className={labelClass}>
                    {t("signerTitle")}
                  </label>
                  <input
                    id="sign-title"
                    className={inputClass}
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="sign-signature" className={labelClass}>
                    {t("signature")}
                  </label>
                  <input
                    id="sign-signature"
                    className={`${inputClass} italic`}
                    placeholder={t("signaturePlaceholder")}
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                  />
                </div>
              </div>
              <p className="mt-3 text-caption text-content-secondary">
                {t("acceptNote", {
                  count: selected.size,
                  total: formatCurrency(selectedTotal, currency),
                })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={buttonPrimaryClass}
                  disabled={
                    pending ||
                    selected.size === 0 ||
                    signerName.trim() === "" ||
                    signature.trim() === ""
                  }
                  onClick={() =>
                    runAction(() =>
                      submitSignDecisionAction(token, {
                        decision: "accepted",
                        signerName,
                        signerTitle,
                        signatureTyped: signature,
                        selectedLineItemIds: [...selected],
                      }),
                    )
                  }
                >
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {t("accept", {
                    total: formatCurrency(selectedTotal, currency),
                  })}
                </button>
                {!confirmDecline ? (
                  <button
                    type="button"
                    className={buttonDangerClass}
                    disabled={pending}
                    onClick={() => setConfirmDecline(true)}
                  >
                    <XCircle size={16} aria-hidden="true" />
                    {t("decline")}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      className={buttonDangerClass}
                      disabled={pending || signerName.trim() === ""}
                      onClick={() =>
                        runAction(() =>
                          submitSignDecisionAction(token, {
                            decision: "declined",
                            signerName,
                            signerTitle,
                            signatureTyped: "",
                            selectedLineItemIds: [],
                          }),
                        )
                      }
                    >
                      {t("declineConfirm")}
                    </button>
                    <button
                      type="button"
                      className={buttonSecondaryClass}
                      disabled={pending}
                      onClick={() => setConfirmDecline(false)}
                    >
                      {t("declineCancel")}
                    </button>
                  </span>
                )}
              </div>
              {confirmDecline && signerName.trim() === "" && (
                <p className="mt-2 text-caption text-content-secondary">
                  {t("declineNeedsName")}
                </p>
              )}
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 flex items-center gap-1 text-body text-error"
            >
              <TriangleAlert size={14} aria-hidden="true" />
              {error}
            </p>
          )}
        </section>
      )}

      <p className="mt-[32px] text-center text-label text-content-muted">
        {t("footer", { business: bundle.businessName ?? "Shyre" })}
      </p>
    </main>
  );
}
