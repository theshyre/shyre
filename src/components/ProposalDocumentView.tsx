"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import { formatDisplayDate } from "@/lib/format-date";
import { MarkdownView } from "@/components/MarkdownView";
import { ProposalItemBody } from "@/components/ProposalItemBody";
import { ProposalSummaryTable } from "@/components/ProposalSummaryTable";
import { PricingTypeBadge } from "@/components/PricingTypeBadge";
import type { PricingType } from "@/lib/proposals/allow-lists";

/**
 * Read-only render of a proposal AS THE CLIENT SEES IT on the sign page —
 * brand header, line items (with the why/scope/DoD detail + phases), terms,
 * and total. Presentational only: no OTP, no selection, no accept/decline.
 *
 * Shared, layer-neutral (`src/components`) so the authed preview route can
 * render it WITHOUT importing the public `(sign)` page (the layer-violation
 * the module boundary forbids). Reuses the `proposals.sign` copy so the
 * preview and the real sign page read identically. The sign page keeps its own
 * SELECTABLE item rendering; only static content is shared here.
 */

export interface ProposalDocumentPhase {
  title: string;
  description: string | null;
  fixedPrice: number;
}
export interface ProposalDocumentItem {
  id: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string | null;
  description: string | null;
  whyItMatters: string | null;
  outOfScope: string | null;
  definitionOfDone: string | null;
  fixedPrice: number;
  isCapped: boolean;
  /** Pricing type for the per-line badge (mixed proposals). Absent ⇒ fixed_bid
   *  (backfill default) — a homogeneous fixed-bid deal shows one assurance line
   *  near the total instead of per-line badges. */
  pricingType?: PricingType;
  phases: ProposalDocumentPhase[];
}
export interface ProposalDocumentViewProps {
  business: {
    name: string | null;
    logoUrl: string | null;
    brandColor: string | null;
    wordmarkPrimary: string | null;
    wordmarkSecondary: string | null;
  };
  customer: {
    name: string | null;
    logoUrl: string | null;
    accentColor: string | null;
  } | null;
  proposal: {
    proposalNumber: string;
    title: string;
    validUntil: string | null;
    paymentTermsLabel: string | null;
    depositType: "none" | "percent" | "amount";
    depositValue: number | null;
    warrantyDays: number | null;
    termsNotes: string | null;
    currency: string;
    overviewMarkdown: string | null;
  };
  items: ProposalDocumentItem[];
  total: number;
  /** Names of the proposal's signers (roster order). When 2+, the acceptance
   *  block renders a signature line PER signer instead of a single "Client"
   *  line — a multi-signer deal needs every authorizer on the paper record. */
  signers?: string[];
}

export function ProposalDocumentView({
  business,
  customer,
  proposal,
  items,
  total,
  signers,
}: ProposalDocumentViewProps): React.JSX.Element {
  const t = useTranslations("proposals.sign");
  const tp = useTranslations("proposals.pricing");
  const currency = proposal.currency;
  // A homogeneous fixed-bid deal shows ONE assurance line near the total; a
  // mixed proposal shows a per-line badge instead. Absent type ⇒ fixed_bid.
  const allFixedBid = items.every(
    (i) => (i.pricingType ?? "fixed_bid") === "fixed_bid",
  );
  const hasTerms =
    !!proposal.paymentTermsLabel ||
    proposal.depositType !== "none" ||
    proposal.warrantyDays != null ||
    !!proposal.termsNotes;

  return (
    <div>
      {/* Brand lockup: the logo AND the two-tone wordmark, side by side (either
          alone if only one is set). */}
      {(business.logoUrl || business.wordmarkPrimary) && (
        <div className="mb-4 flex items-center gap-3">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored public URL
            <img
              src={business.logoUrl}
              alt=""
              aria-hidden="true"
              className="max-h-[48px] w-auto object-contain"
            />
          ) : null}
          {business.wordmarkPrimary ? (
            <p aria-hidden="true" className="text-title font-semibold">
              <span style={{ color: business.brandColor ?? undefined }}>
                {business.wordmarkPrimary}
              </span>
              {business.wordmarkSecondary ? (
                <span className="text-content">
                  {business.wordmarkSecondary}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      )}

      <p className="text-caption uppercase tracking-wide text-content-muted">
        {t("heading", { business: business.name ?? "—" })}
      </p>
      <h1 className="mt-1 text-page-title font-semibold text-content">
        {proposal.title}
      </h1>
      <p className="mt-1 font-mono text-caption text-content-secondary">
        {proposal.proposalNumber}
        {proposal.validUntil
          ? ` · ${t("validUntil", { date: formatDisplayDate(proposal.validUntil) })}`
          : ""}
      </p>

      {(customer?.name || customer?.logoUrl) && (
        <div className="mt-4 flex items-center gap-3">
          {customer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored public URL
            <img
              src={customer.logoUrl}
              alt=""
              aria-hidden="true"
              className="max-h-[64px] w-auto object-contain"
            />
          ) : null}
          {customer.name ? (
            <span className="text-body-lg text-content-secondary">
              {t("preparedForLabel")}{" "}
              {/* Accent as decorative underline only — stored hex has no
                  contrast guarantee against the pinned theme (WCAG 1.4.3). */}
              <span
                className={`font-semibold text-content ${
                  customer.accentColor
                    ? "underline decoration-2 underline-offset-4"
                    : ""
                }`}
                style={{
                  textDecorationColor: customer.accentColor ?? undefined,
                }}
              >
                {customer.name}
              </span>
            </span>
          ) : null}
        </div>
      )}

      {/* Proposal-level overview (markdown), above the line items. */}
      {proposal.overviewMarkdown && proposal.overviewMarkdown.trim() !== "" && (
        <div className="mt-[24px]">
          <MarkdownView content={proposal.overviewMarkdown} />
        </div>
      )}

      {/* Auto summary / pricing table (2+ items). */}
      <ProposalSummaryTable
        items={items.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          fixedPrice: item.fixedPrice,
        }))}
        total={total}
        currency={currency}
      />

      {/* Line items */}
      <section className="mt-[24px]">
        <h2 className="text-title font-semibold text-content">
          {t("itemsHeading")}
        </h2>
        <div className="mt-3 space-y-[12px]">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-edge p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-body-lg font-semibold text-content">
                  {item.title}
                  <PricingTypeBadge type={item.pricingType ?? "fixed_bid"} />
                </span>
                <span className="font-mono text-body-lg text-content">
                  {formatCurrency(item.fixedPrice, currency)}
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
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between border-t border-edge pt-2">
          <span className="text-body-lg font-semibold text-content">
            {t("fullTotal")}
          </span>
          <span className="font-mono text-title font-semibold text-content">
            {formatCurrency(total, currency)}
          </span>
        </div>
        {allFixedBid && items.length > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2">
            <ShieldCheck
              size={18}
              aria-hidden="true"
              className="shrink-0 text-success-text"
            />
            <span className="text-body font-medium text-success-text">
              {tp("fixedPriceAssurance")}
            </span>
          </div>
        )}
      </section>

      {hasTerms && (
        <section className="mt-[24px]">
          <h2 className="text-title font-semibold text-content">
            {t("termsHeading")}
          </h2>
          <ul className="mt-2 space-y-1 text-body text-content-secondary">
            {proposal.paymentTermsLabel && (
              <li>
                {t("paymentTerms")}: {proposal.paymentTermsLabel}
              </li>
            )}
            {proposal.depositType === "percent" &&
              proposal.depositValue != null && (
                <li>
                  {t("deposit")}:{" "}
                  {t("depositPercent", { value: proposal.depositValue })}
                </li>
              )}
            {proposal.depositType === "amount" &&
              proposal.depositValue != null && (
                <li>
                  {t("deposit")}: {formatCurrency(proposal.depositValue, currency)}
                </li>
              )}
            {proposal.warrantyDays != null && (
              <li>
                {t("warranty")}: {t("warrantyDays", { days: proposal.warrantyDays })}
              </li>
            )}
          </ul>
          {proposal.termsNotes && (
            <p className="mt-2 whitespace-pre-wrap text-body text-content-secondary">
              {proposal.termsNotes}
            </p>
          )}
        </section>
      )}

      {/* Acceptance & Authorization — the document's signature section (this is
          how the PDF closes). On-screen it's a read-only preview; the actual
          sign-off happens on the client's interactive sign page or on paper. */}
      <section className="mt-[32px] border-t border-edge pt-4">
        <h2 className="text-title font-semibold text-content">
          {t("acceptanceHeading")}
        </h2>
        <p className="mt-2 text-body text-content-secondary">
          {t("acceptanceStatement")}
        </p>
        <div className="mt-5 grid grid-cols-1 gap-8 sm:grid-cols-2">
          {[
            // A multi-signer proposal (2+ roster signers) gets a signature line
            // per signer; a single/legacy signer keeps the one "Client" line.
            ...(signers && signers.length >= 2
              ? signers.map((name) => ({ role: t("partyClient"), name }))
              : [{ role: t("partyClient"), name: customer?.name ?? "—" }]),
            { role: t("partyProvider"), name: business.name ?? "—" },
          ].map((party, i) => (
            <div key={`${party.role}-${i}`}>
              <p className="text-body-lg font-semibold text-content">
                {party.role} — {party.name}
              </p>
              {[t("sigSignature"), t("sigNameTitle"), t("sigDate")].map(
                (label) => (
                  <div key={label} className="mt-6">
                    <div className="border-b border-content" />
                    <p className="mt-1 text-caption text-content-muted">
                      {label}
                    </p>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
