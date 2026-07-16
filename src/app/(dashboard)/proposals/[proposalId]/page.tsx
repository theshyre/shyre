import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { roundMoney } from "@/lib/proposals/line-items";
import type { ProposalPDFItem } from "@/components/ProposalPDF";
import { CustomerChip } from "@/components/CustomerChip";
import { ProposalStatusBadge } from "../proposal-status-badge";
import { DeleteProposalButton } from "../delete-proposal-button";
import { ProposalPdfButton, type ProposalPdfBundle } from "./proposal-pdf-button";
import { isProposalEditable, type DepositType } from "../allow-lists";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals");
  return { title: t("title") };
}

interface LineItemRow {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  description: string | null;
  why_it_matters: string | null;
  out_of_scope: string | null;
  definition_of_done: string | null;
  fixed_price: number | string;
  is_capped: boolean;
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}): Promise<React.JSX.Element> {
  const { proposalId } = await params;
  const supabase = await createClient();
  const t = await getTranslations("proposals.detail");

  const { data: proposal } = await supabase
    .from("proposals")
    .select(
      "*, customers(id, name, email, address, show_country_on_invoice), customer_contacts(id, name, email)",
    )
    .eq("id", proposalId)
    .single();
  if (!proposal) notFound();

  const { data: itemRows } = await supabase
    .from("proposal_line_items")
    .select(
      "id, parent_line_item_id, sort_order, title, description, why_it_matters, out_of_scope, definition_of_done, fixed_price, is_capped",
    )
    .eq("proposal_id", proposalId)
    .order("sort_order");

  const { data: branding } = await supabase
    .from("team_settings")
    .select(
      "business_name, business_email, business_address, business_phone, wordmark_primary, wordmark_secondary, brand_color, show_country_on_invoice",
    )
    .eq("team_id", proposal.team_id as string)
    .single();

  interface CustomerRow {
    id: string;
    name: string;
    email: string | null;
    address: string | null;
    show_country_on_invoice: boolean | null;
  }
  const customer = Array.isArray(proposal.customers)
    ? ((proposal.customers[0] ?? null) as CustomerRow | null)
    : (proposal.customers as CustomerRow | null);
  const signer = Array.isArray(proposal.customer_contacts)
    ? ((proposal.customer_contacts[0] ?? null) as { name: string } | null)
    : (proposal.customer_contacts as { name: string } | null);

  // Build the item tree: top-level items in order, phases nested.
  const rows = (itemRows ?? []) as LineItemRow[];
  const parents = rows.filter((r) => r.parent_line_item_id === null);
  const items: ProposalPDFItem[] = parents.map((parent) => ({
    title: parent.title,
    description: parent.description,
    whyItMatters: parent.why_it_matters,
    outOfScope: parent.out_of_scope,
    definitionOfDone: parent.definition_of_done,
    fixedPrice: Number(parent.fixed_price),
    isCapped: parent.is_capped,
    phases: rows
      .filter((r) => r.parent_line_item_id === parent.id)
      .map((phase) => ({
        title: phase.title,
        fixedPrice: Number(phase.fixed_price),
      })),
  }));
  const total = roundMoney(items.reduce((sum, i) => sum + i.fixedPrice, 0));
  const currency = (proposal.currency as string) ?? "USD";
  const status = (proposal.status as string) ?? "draft";
  const editable = isProposalEditable(status);

  const pdfBundle: ProposalPdfBundle = {
    proposal: {
      proposal_number: proposal.proposal_number as string,
      title: proposal.title as string,
      issued_date: (proposal.issued_date as string | null) ?? null,
      valid_until: (proposal.valid_until as string | null) ?? null,
      payment_terms_label:
        (proposal.payment_terms_label as string | null) ?? null,
      deposit_type: (proposal.deposit_type as DepositType) ?? "none",
      deposit_value:
        proposal.deposit_value != null ? Number(proposal.deposit_value) : null,
      warranty_days: (proposal.warranty_days as number | null) ?? null,
      terms_notes: (proposal.terms_notes as string | null) ?? null,
      currency,
    },
    items,
    total,
    client: customer,
    signerName: signer?.name ?? null,
    business: branding ?? null,
  };

  return (
    <div className="max-w-[880px]">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title font-semibold text-content">
              {proposal.title as string}
            </h1>
            <ProposalStatusBadge status={status} size="prominent" />
          </div>
          <p className="mt-1 font-mono text-caption text-content-secondary">
            {proposal.proposal_number as string}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProposalPdfButton bundle={pdfBundle} />
          {editable && (
            <>
              <Link
                href={`/proposals/${proposalId}/edit`}
                className={buttonSecondaryClass}
              >
                <Pencil size={16} aria-hidden="true" />
                {t("edit")}
              </Link>
              <DeleteProposalButton proposalId={proposalId} />
            </>
          )}
        </div>
      </div>

      {/* meta */}
      <dl className="mt-[24px] grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-caption text-content-secondary">
            {t("customer")}
          </dt>
          <dd className="text-body text-content">
            <span className="inline-flex items-center gap-2">
              <CustomerChip
                customerId={customer?.id}
                customerName={customer?.name}
              />
              {customer?.name ?? "—"}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">{t("signer")}</dt>
          <dd className="text-body text-content">{signer?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">{t("issued")}</dt>
          <dd className="text-body text-content">
            {(proposal.issued_date as string | null) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">
            {t("validUntil")}
          </dt>
          <dd className="text-body text-content">
            {(proposal.valid_until as string | null) ?? "—"}
          </dd>
        </div>
      </dl>

      {/* items */}
      <h2 className="mt-[32px] text-heading font-semibold text-content">
        {t("itemsHeading")}
      </h2>
      <div className="mt-3 space-y-[12px]">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-edge p-4">
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
            <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {item.whyItMatters && (
                <div>
                  <p className="text-label font-semibold uppercase text-content-muted">
                    {t("whyItMatters")}
                  </p>
                  <p className="text-body text-content-secondary">
                    {item.whyItMatters}
                  </p>
                </div>
              )}
              {item.outOfScope && (
                <div>
                  <p className="text-label font-semibold uppercase text-content-muted">
                    {t("outOfScope")}
                  </p>
                  <p className="text-body text-content-secondary">
                    {item.outOfScope}
                  </p>
                </div>
              )}
              {item.definitionOfDone && (
                <div>
                  <p className="text-label font-semibold uppercase text-content-muted">
                    {t("definitionOfDone")}
                  </p>
                  <p className="text-body text-content-secondary">
                    {item.definitionOfDone}
                  </p>
                </div>
              )}
            </div>
            {item.phases.length > 0 && (
              <div className="mt-3 border-t border-edge pt-2">
                <p className="text-label font-semibold uppercase text-content-muted">
                  {t("phasesHeading")}
                  {item.isCapped && (
                    <span className="ml-2 rounded-full bg-surface-inset px-2 py-0.5 text-label normal-case text-content-secondary">
                      {t("capped")}
                    </span>
                  )}
                </p>
                <ul className="mt-1 space-y-1">
                  {item.phases.map((phase, j) => (
                    <li
                      key={j}
                      className="flex items-baseline justify-between pl-[16px] text-body"
                    >
                      <span className="text-content-secondary">
                        {phase.title}
                      </span>
                      <span className="font-mono text-content-secondary">
                        {formatCurrency(phase.fixedPrice, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* total */}
      <div className="mt-4 flex items-baseline justify-between border-t border-edge pt-3">
        <span className="text-body-lg font-semibold text-content">
          {t("total")}
        </span>
        <span className="font-mono text-title font-semibold text-content">
          {formatCurrency(total, currency)}
        </span>
      </div>

      {/* terms */}
      <h2 className="mt-[32px] text-heading font-semibold text-content">
        {t("termsHeading")}
      </h2>
      <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-content-secondary">
            {t("paymentTerms")}
          </dt>
          <dd className="text-body text-content">
            {(proposal.payment_terms_label as string | null) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">
            {t("deposit")}
          </dt>
          <dd className="text-body text-content">
            {proposal.deposit_type === "percent" && proposal.deposit_value != null
              ? t("depositPercentValue", {
                  value: Number(proposal.deposit_value),
                })
              : proposal.deposit_type === "amount" &&
                  proposal.deposit_value != null
                ? formatCurrency(Number(proposal.deposit_value), currency)
                : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">
            {t("warranty")}
          </dt>
          <dd className="text-body text-content">
            {proposal.warranty_days != null
              ? t("warrantyDaysValue", {
                  days: proposal.warranty_days as number,
                })
              : "—"}
          </dd>
        </div>
      </dl>
      {typeof proposal.terms_notes === "string" && proposal.terms_notes && (
        <p className="mt-2 whitespace-pre-wrap text-body text-content-secondary">
          {proposal.terms_notes}
        </p>
      )}
    </div>
  );
}
