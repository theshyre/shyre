"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
 *
 * Built for external, possibly non-technical signers using any assistive
 * tech: real <form> semantics (Enter submits each step), a persistent polite
 * live region announcing step transitions, deliberate focus re-homing when a
 * refresh swaps the visible step, and checkbox names scoped to title + price
 * (the contract prose stays selectable without toggling a selection).
 */
export function SignExperience({ token, bundle }: Props): React.JSX.Element {
  const t = useTranslations("proposals.sign");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [otpRequested, setOtpRequested] = useState(bundle.otpPending);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Persistent polite live region (mounted from first render — live regions
  // inserted WITH their content are not reliably announced). Success
  // transitions write here; router.refresh() re-renders in place so the
  // node persists across state flips.
  const [announcement, setAnnouncement] = useState("");
  const otpInputRef = useRef<HTMLInputElement>(null);
  const signHeadingRef = useRef<HTMLHeadingElement>(null);
  const decidedBannerRef = useRef<HTMLDivElement>(null);

  // Focus management across the refresh-driven state transitions: the
  // element the user activated unmounts, so deliberately re-home focus to
  // the next step instead of letting it drop to <body>.
  const prevVerified = useRef(bundle.otpVerified);
  const prevDecided = useRef(bundle.decided);
  useEffect(() => {
    if (!prevVerified.current && bundle.otpVerified && !bundle.decided) {
      signHeadingRef.current?.focus();
    }
    if (!prevDecided.current && bundle.decided) {
      decidedBannerRef.current?.focus();
    }
    prevVerified.current = bundle.otpVerified;
    prevDecided.current = bundle.decided;
  }, [bundle.otpVerified, bundle.decided]);

  // When the code field appears (after "Email me a code"), put the caret in it.
  const prevRequested = useRef(otpRequested);
  useEffect(() => {
    if (!prevRequested.current && otpRequested) {
      otpInputRef.current?.focus();
    }
    prevRequested.current = otpRequested;
  }, [otpRequested]);

  // Which action is in flight — drives per-button pending labels.
  const [pendingAction, setPendingAction] = useState<
    "otp_send" | "otp_verify" | "accept" | "decline" | null
  >(null);

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
      case "offer_expired":
        return t("errors.offerExpired");
      case "email_failed":
        return t("errors.emailFailed");
      default:
        return t("errors.generic");
    }
  }

  function runAction(
    action: "otp_send" | "otp_verify" | "accept" | "decline",
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
        router.refresh();
      } else {
        setError(failureMessage(result));
      }
    });
  }

  const decided = bundle.decided;
  const decidedAccepted = bundle.proposal.status === "accepted";
  const selectable = !decided && bundle.otpVerified;
  const acceptMissing: string[] = [];
  if (selected.size === 0) acceptMissing.push(t("missingSelection"));
  if (signerName.trim() === "") acceptMissing.push(t("missingName"));
  if (signature.trim() === "") acceptMissing.push(t("missingSignature"));

  return (
    <main className="mx-auto max-w-[720px] px-[24px] py-[40px]">
      {/* Persistent live region — announces step transitions (code sent /
          verified / decision recorded) to assistive tech. */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>

      {/* Document header */}
      <p className="text-caption uppercase tracking-wide text-content-muted">
        {t("heading", { business: bundle.businessName ?? "—" })}
      </p>
      <h1 className="mt-1 text-page-title font-semibold text-content">
        {bundle.proposal.title}
      </h1>
      <p className="mt-1 font-mono text-caption text-content-secondary">
        {bundle.proposal.proposalNumber}
        {bundle.proposal.validUntil
          ? ` · ${t("validUntil", { date: bundle.proposal.validUntil })}`
          : ""}
      </p>

      {/* Offer-expiry notice: acceptance is blocked server-side too; a
          decline remains recordable. Icon + text + warning color. */}
      {!decided && bundle.offerExpired && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-lg border border-warning-text bg-warning-soft p-3 text-body text-warning-text"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          {t("offerExpiredNotice", { date: bundle.proposal.validUntil ?? "" })}
        </div>
      )}

      {/* Decision banner (terminal states). Focus lands here after the
          decision records; tabIndex=-1 makes it programmatically focusable. */}
      {decided && (
        <div
          ref={decidedBannerRef}
          tabIndex={-1}
          className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-body focus:outline-none ${
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

      {/* Line items — selectable once verified; the subset rule is stated up
          front so the read-only stage doesn't read as all-or-nothing. */}
      <section className="mt-[24px]">
        <h2 className="text-title font-semibold text-content">
          {t("itemsHeading")}
        </h2>
        {!decided && (
          <p className="mt-1 text-caption text-content-secondary">
            {selectable ? t("itemsHint") : t("itemsHintPreVerify")}
          </p>
        )}
        <div className="mt-3 space-y-[12px]">
          {bundle.items.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg border border-edge p-4 ${
                selectable && selected.has(item.id) ? "bg-accent-soft" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                {selectable && (
                  <input
                    type="checkbox"
                    id={`sign-item-${item.id}`}
                    className="mt-1"
                    // Name = title + price only. The card body (scope prose a
                    // signer must be able to select/copy) stays OUTSIDE the
                    // label so reading it never toggles a selection.
                    aria-labelledby={`sit-${item.id} sip-${item.id}`}
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
                    {selectable ? (
                      <label
                        id={`sit-${item.id}`}
                        htmlFor={`sign-item-${item.id}`}
                        className="cursor-pointer text-body-lg font-semibold text-content"
                      >
                        {item.title}
                      </label>
                    ) : (
                      <span
                        id={`sit-${item.id}`}
                        className="text-body-lg font-semibold text-content"
                      >
                        {item.title}
                      </span>
                    )}
                    <span
                      id={`sip-${item.id}`}
                      className="font-mono text-body-lg text-content"
                    >
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
            </div>
          ))}
        </div>

        {/* aria-live: toggling an item changes a MONEY figure — announce it. */}
        <div
          aria-live={selectable ? "polite" : undefined}
          className="mt-3 flex items-baseline justify-between border-t border-edge pt-2"
        >
          <span className="text-body-lg font-semibold text-content">
            {selectable ? t("selectedTotal") : t("fullTotal")}
          </span>
          <span className="font-mono text-title font-semibold text-content">
            {formatCurrency(selectable ? selectedTotal : fullTotal, currency)}
          </span>
        </div>
      </section>

      {/* Terms */}
      {(bundle.proposal.paymentTermsLabel ||
        bundle.proposal.depositType !== "none" ||
        bundle.proposal.warrantyDays != null ||
        bundle.proposal.termsNotes) && (
        <section className="mt-[24px]">
          <h2 className="text-title font-semibold text-content">
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (otpRequested && otpCode.length === 6) {
                  runAction(
                    "otp_verify",
                    () => verifySignOtpAction(token, otpCode),
                    undefined,
                    t("announceVerified"),
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
              <h2 className="flex items-center gap-2 text-body-lg font-semibold text-content">
                <MailCheck size={16} aria-hidden="true" />
                {t("otpHeading")}
              </h2>
              <p className="mt-1 text-body text-content-secondary">
                {t("otpHint", { email: bundle.signerEmail })}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <button
                  type={otpRequested ? "button" : "submit"}
                  // The single forward action pre-request → primary; demoted
                  // once the code entry becomes the main path.
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
                      <label htmlFor="sign-otp" className={labelClass}>
                        {t("otpLabel")}
                      </label>
                      <input
                        id="sign-otp"
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
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (bundle.offerExpired || acceptMissing.length > 0 || pending) {
                  return;
                }
                runAction(
                  "accept",
                  () =>
                    submitSignDecisionAction(token, {
                      decision: "accepted",
                      signerName,
                      signerTitle,
                      signatureTyped: signature,
                      selectedLineItemIds: [...selected],
                    }),
                  undefined,
                  t("announceDecided"),
                );
              }}
            >
              <h2
                ref={signHeadingRef}
                tabIndex={-1}
                className="flex items-center gap-2 text-body-lg font-semibold text-content focus:outline-none"
              >
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
                    required
                    aria-required="true"
                    autoFocus
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
                    required
                    aria-required="true"
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
                {!bundle.offerExpired && (
                  <button
                    type="submit"
                    className={buttonPrimaryClass}
                    disabled={pending || acceptMissing.length > 0}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {pendingAction === "accept"
                      ? t("accepting")
                      : t("accept", {
                          total: formatCurrency(selectedTotal, currency),
                        })}
                  </button>
                )}
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
                        runAction(
                          "decline",
                          () =>
                            submitSignDecisionAction(token, {
                              decision: "declined",
                              signerName,
                              signerTitle,
                              signatureTyped: "",
                              selectedLineItemIds: [],
                            }),
                          undefined,
                          t("announceDecided"),
                        )
                      }
                    >
                      {pendingAction === "decline"
                        ? t("declining")
                        : t("declineConfirm")}
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
              {/* A dead-looking primary button with no reason is the classic
                  "is this broken?" moment — say what's missing. */}
              {!bundle.offerExpired && acceptMissing.length > 0 && (
                <p className="mt-2 text-caption text-content-secondary">
                  {t("acceptMissing", { missing: acceptMissing.join(", ") })}
                </p>
              )}
              {confirmDecline && signerName.trim() === "" && (
                <p className="mt-2 text-caption text-content-secondary">
                  {t("declineNeedsName")}
                </p>
              )}
            </form>
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
