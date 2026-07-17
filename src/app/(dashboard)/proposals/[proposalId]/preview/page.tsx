import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { roundMoney } from "@/lib/proposals/line-items";
import {
  ProposalDocumentView,
  type ProposalDocumentItem,
} from "@/components/ProposalDocumentView";
import type { DepositType } from "../../allow-lists";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals.preview");
  return { title: t("title") };
}

interface Row {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  description: string | null;
  why_it_matters: string | null;
  out_of_scope: string | null;
  definition_of_done: string | null;
  fixed_price: number | string;
  is_capped: boolean;
}

/**
 * Author-facing preview: the proposal rendered exactly as the client will see
 * it on the sign page, but READ-ONLY and — critically — NON-CONSUMING. It loads
 * the proposal with plain SELECTs (authed, RLS-scoped), never `loadSignBundle`,
 * so opening the preview can't flip a sent proposal to `viewed` or touch any
 * lifecycle state. Owner/admin visibility is enforced by RLS.
 */
export default async function ProposalPreviewPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}): Promise<React.JSX.Element> {
  const { proposalId } = await params;
  const supabase = await createClient();
  const t = await getTranslations("proposals.preview");

  const { data: proposal } = await supabase
    .from("proposals")
    .select(
      "id, team_id, proposal_number, title, valid_until, payment_terms_label, deposit_type, deposit_value, warranty_days, terms_notes, overview_markdown, currency, customers(name, accent_color, logo_url)",
    )
    .eq("id", proposalId)
    .single();
  if (!proposal) notFound();

  const { data: itemRows } = await supabase
    .from("proposal_line_items")
    .select(
      "id, parent_line_item_id, sort_order, title, summary, body_markdown, description, why_it_matters, out_of_scope, definition_of_done, fixed_price, is_capped",
    )
    .eq("proposal_id", proposalId)
    .order("sort_order");

  const { data: branding } = await supabase
    .from("team_settings")
    .select("business_name, wordmark_primary, wordmark_secondary, brand_color, logo_url")
    .eq("team_id", proposal.team_id as string)
    .single();

  const rows = (itemRows ?? []) as Row[];
  const parents = rows.filter((r) => r.parent_line_item_id === null);
  const items: ProposalDocumentItem[] = parents.map((parent) => ({
    id: parent.id,
    title: parent.title,
    summary: parent.summary ?? null,
    bodyMarkdown: parent.body_markdown,
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
        description: phase.description,
        fixedPrice: Number(phase.fixed_price),
      })),
  }));
  const total = roundMoney(items.reduce((sum, i) => sum + i.fixedPrice, 0));

  const customerRaw = Array.isArray(proposal.customers)
    ? (proposal.customers[0] ?? null)
    : proposal.customers;
  const customer = customerRaw
    ? {
        name: (customerRaw as { name: string | null }).name ?? null,
        logoUrl: (customerRaw as { logo_url: string | null }).logo_url ?? null,
        accentColor:
          (customerRaw as { accent_color: string | null }).accent_color ?? null,
      }
    : null;

  return (
    <div className="max-w-[880px]">
      {/* Preview chrome — never part of what the client sees. */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-raised px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={16} aria-hidden="true" className="text-accent" />
          <div>
            <p className="text-body-lg font-semibold text-content">
              {t("title")}
            </p>
            <p className="text-caption text-content-secondary">{t("subtitle")}</p>
          </div>
        </div>
        <Link href={`/proposals/${proposalId}`} className={buttonSecondaryClass}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t("back")}
        </Link>
      </div>

      {/* The document, exactly as the client's sign page renders it. */}
      <div className="rounded-lg border border-edge bg-surface p-[24px]">
        <ProposalDocumentView
          business={{
            name: (branding?.business_name as string | null) ?? null,
            logoUrl: (branding?.logo_url as string | null) ?? null,
            brandColor: (branding?.brand_color as string | null) ?? null,
            wordmarkPrimary: (branding?.wordmark_primary as string | null) ?? null,
            wordmarkSecondary:
              (branding?.wordmark_secondary as string | null) ?? null,
          }}
          customer={customer}
          proposal={{
            proposalNumber: proposal.proposal_number as string,
            title: proposal.title as string,
            validUntil: (proposal.valid_until as string | null) ?? null,
            paymentTermsLabel:
              (proposal.payment_terms_label as string | null) ?? null,
            depositType: (proposal.deposit_type as DepositType) ?? "none",
            depositValue:
              proposal.deposit_value != null
                ? Number(proposal.deposit_value)
                : null,
            warrantyDays: (proposal.warranty_days as number | null) ?? null,
            termsNotes: (proposal.terms_notes as string | null) ?? null,
            overviewMarkdown: (proposal.overview_markdown as string | null) ?? null,
            currency: (proposal.currency as string) ?? "USD",
          }}
          items={items}
          total={total}
        />
      </div>
    </div>
  );
}
