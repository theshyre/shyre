"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MarkdownView } from "@/components/MarkdownView";
import { ProposalItemBody } from "@/components/ProposalItemBody";
import { ProposalSummaryTable } from "@/components/ProposalSummaryTable";
import { PricingTypeBadge } from "@/components/PricingTypeBadge";
import { ItemPrice } from "@/components/ItemPrice";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  TriangleAlert,
  Clock,
  Lock,
} from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
  checkboxToggleClass,
} from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { formatDisplayDate } from "@/lib/format-date";
import {
  roundMoney,
  isHomogeneousFixedBid,
} from "@/lib/proposals/line-items";
import type { SignBundle } from "@/lib/proposals/sign-service";
import {
  submitSignDecisionAction,
  type PublicActionResult,
} from "./actions";
import { signFailureKey } from "@/lib/proposals/sign-failure";

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

  const [error, setError] = useState<string | null>(null);
  // Persistent polite live region (mounted from first render — live regions
  // inserted WITH their content are not reliably announced). Success
  // transitions write here; router.refresh() re-renders in place so the
  // node persists across state flips.
  const [announcement, setAnnouncement] = useState("");
  const signHeadingRef = useRef<HTMLHeadingElement>(null);
  const decidedBannerRef = useRef<HTMLDivElement>(null);

  // Focus management across the refresh-driven state transitions: the
  // element the user activated unmounts, so deliberately re-home focus to
  // the next step instead of letting it drop to <body>.
  const prevDecided = useRef(bundle.decided);
  useEffect(() => {
    if (!prevDecided.current && bundle.decided) {
      decidedBannerRef.current?.focus();
    }
    prevDecided.current = bundle.decided;
  }, [bundle.decided]);

  // Which action is in flight — drives per-button pending labels.
  const [pendingAction, setPendingAction] = useState<
    "accept" | "decline" | null
  >(null);

  // A bound co-signer ('all' mode, after the primary authorized) sees the
  // primary's fixed subset — pre-selected and read-only. Everyone else starts
  // with all items selected and may deselect.
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(bundle.boundSelectedIds ?? bundle.items.map((item) => item.id)),
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
    return t(signFailureKey(result.reason));
  }

  function runAction(
    action: "accept" | "decline",
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
  // A bound co-signer cannot change the subset — it's the primary's.
  const isBound = bundle.boundSelectedIds !== null;
  const selectable = !decided && !isBound;
  const acceptMissing: string[] = [];
  // A co-signer whose primary hasn't authorized yet can't sign at all.
  if (bundle.awaitingPrimary) acceptMissing.push(t("awaitingPrimary"));
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

      {/* Brand lockup: the logo AND the two-tone wordmark, side by side (either
          alone if only one is set). Decorative — the business name is restated
          in the eyebrow below, so this is aria-hidden. */}
      {(bundle.businessLogoUrl || bundle.wordmarkPrimary) && (
        <div className="mb-4 flex items-center gap-3">
          {bundle.businessLogoUrl ? (
            // Public Supabase URL on a login-free page; next/image would need
            // remotePatterns and the avatar precedent uses a plain <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bundle.businessLogoUrl}
              alt=""
              aria-hidden="true"
              className="max-h-[48px] w-auto object-contain"
            />
          ) : null}
          {bundle.wordmarkPrimary ? (
            <p aria-hidden="true" className="text-title font-semibold">
              <span style={{ color: bundle.brandColor ?? undefined }}>
                {bundle.wordmarkPrimary}
              </span>
              {bundle.wordmarkSecondary ? (
                <span className="text-content">{bundle.wordmarkSecondary}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      )}

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
          ? ` · ${t("validUntil", { date: formatDisplayDate(bundle.proposal.validUntil) })}`
          : ""}
      </p>

      {/* Customer co-brand: their own logo + accent, so the client sees their
          identity on the document prepared for them. Logo is decorative
          (aria-hidden) — the name carries the accessible label. */}
      {(bundle.customerName || bundle.customerLogoUrl) && (
        <div className="mt-4 flex items-center gap-3">
          {bundle.customerLogoUrl ? (
            // Public Supabase URL on a login-free page; plain <img> per the
            // avatar precedent.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bundle.customerLogoUrl}
              alt=""
              aria-hidden="true"
              className="max-h-[64px] w-auto object-contain"
            />
          ) : null}
          {bundle.customerName ? (
            <span className="text-body-lg text-content-secondary">
              {t("preparedForLabel")}{" "}
              {/* Accent is DECORATIVE (underline), never the text color —
                  the stored hex has no contrast guarantee against the
                  pinned theme (WCAG 1.4.3), so the name stays text-content. */}
              <span
                className={`font-semibold text-content ${
                  bundle.customerAccentColor
                    ? "underline decoration-2 underline-offset-4"
                    : ""
                }`}
                style={{
                  textDecorationColor: bundle.customerAccentColor ?? undefined,
                }}
              >
                {bundle.customerName}
              </span>
            </span>
          ) : null}
        </div>
      )}

      {/* Offer-expiry notice: acceptance is blocked server-side too; a
          decline remains recordable. Icon + text + warning color. */}
      {!decided && bundle.offerExpired && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-lg border border-warning-text bg-warning-soft p-3 text-body text-warning-text"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          {t("offerExpiredNotice", { date: formatDisplayDate(bundle.proposal.validUntil) })}
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

      {/* Proposal-level overview (markdown), above the items. */}
      {bundle.overviewMarkdown && bundle.overviewMarkdown.trim() !== "" && (
        <div className="mt-[24px]">
          <MarkdownView content={bundle.overviewMarkdown} />
        </div>
      )}

      {/* Auto summary / pricing table (2+ items). */}
      <ProposalSummaryTable
        items={bundle.items.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          fixedPrice: item.fixedPrice,
          pricingType: item.pricingType,
          hourlyRate: item.hourlyRate,
          estimateLow: item.estimateLow,
          estimateHigh: item.estimateHigh,
        }))}
        total={fullTotal}
        currency={currency}
        allFixedBid={isHomogeneousFixedBid(bundle.items)}
      />

      {/* Multi-signer notices: a co-signer either waits for the primary to set
          the scope, or is bound to the scope the primary already authorized. */}
      {!decided && bundle.awaitingPrimary && (
        <div
          role="status"
          className="mt-[24px] flex items-start gap-2 rounded-lg border border-edge bg-surface-raised p-4 text-body text-content-secondary"
        >
          <Clock size={16} aria-hidden="true" className="mt-0.5 text-accent" />
          <span>{t("awaitingPrimaryNote")}</span>
        </div>
      )}
      {!decided && !bundle.awaitingPrimary && isBound && (
        <div
          role="status"
          className="mt-[24px] flex items-start gap-2 rounded-lg border border-edge bg-surface-raised p-4 text-body text-content-secondary"
        >
          <Lock size={16} aria-hidden="true" className="mt-0.5 text-accent" />
          <span>{t("boundSubsetNote")}</span>
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
                    className={`mt-1 ${checkboxToggleClass}`}
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
                    <span className="flex items-center gap-2">
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
                      <PricingTypeBadge type={item.pricingType} />
                    </span>
                    <span
                      id={`sip-${item.id}`}
                      className="font-mono text-body-lg text-content"
                    >
                      <ItemPrice
                        pricingType={item.pricingType}
                        fixedPrice={item.fixedPrice}
                        hourlyRate={item.hourlyRate}
                        estimateLow={item.estimateLow}
                        estimateHigh={item.estimateHigh}
                        currency={currency}
                      />
                    </span>
                  </div>
                  <ProposalItemBody
                    bodyMarkdown={item.bodyMarkdown}
                    description={item.description}
                    whyItMatters={item.whyItMatters}
                    outOfScope={item.outOfScope}
                    definitionOfDone={item.definitionOfDone}
                    labels={{
                      whyItMatters: t("whyItMatters"),
                      outOfScope: t("outOfScope"),
                      definitionOfDone: t("definitionOfDone"),
                    }}
                  />
                  {item.phases.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-edge pt-2">
                      {item.phases.map((phase, j) => (
                        <li
                          key={j}
                          className="flex justify-between gap-3 pl-[12px] text-caption text-content-secondary"
                        >
                          <span className="flex-1">
                            <span className="font-semibold text-content">
                              {phase.title}
                            </span>
                            {phase.description ? ` ${phase.description}` : ""}
                          </span>
                          <span className="whitespace-nowrap font-mono">
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
          {/* The identity gate (SignGate) owns OTP now — by the time this
              component renders, the browser is verified. The old inline OTP
              branch was unreachable AND a drift-prone copy of the live one. */}
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
