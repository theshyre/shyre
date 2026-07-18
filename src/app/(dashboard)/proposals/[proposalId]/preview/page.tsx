import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonSecondaryClass } from "@/lib/form-styles";
import {
  roundMoney,
  buildProposalItemTree,
  PROPOSAL_ITEM_COLUMNS,
  type ProposalItemDbRow,
} from "@/lib/proposals/line-items";
import { loadProposalRoster } from "@/lib/proposals/roster";
import { unwrapEmbed } from "@/lib/supabase/embed";
import {
  ProposalDocumentView,
  type ProposalDocumentItem,
} from "@/components/ProposalDocumentView";
import { resolveSignTheme, type DepositType } from "@/lib/proposals/allow-lists";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals.preview");
  return { title: t("title") };
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
      "id, team_id, proposal_number, title, valid_until, payment_terms_label, deposit_type, deposit_value, warranty_days, terms_notes, overview_markdown, sign_theme, currency, customers(name, accent_color, logo_url)",
    )
    .eq("id", proposalId)
    .single();
  if (!proposal) notFound();

  const { data: itemRows } = await supabase
    .from("proposal_line_items")
    .select(PROPOSAL_ITEM_COLUMNS)
    .eq("proposal_id", proposalId)
    .order("sort_order");

  const { data: branding } = await supabase
    .from("team_settings")
    .select("business_name, wordmark_primary, wordmark_secondary, brand_color, logo_url")
    .eq("team_id", proposal.team_id as string)
    .single();

  // Signer roster (2+ signers) — each gets a signature line in the acceptance
  // block so the preview matches the multi-signer document the client receives.
  const signers = (await loadProposalRoster(supabase, proposalId)).map(
    (entry) => entry.name,
  );

  const items: ProposalDocumentItem[] = buildProposalItemTree(
    (itemRows ?? []) as ProposalItemDbRow[],
  );
  const total = roundMoney(items.reduce((sum, i) => sum + i.fixedPrice, 0));

  interface CustomerBrandRow {
    name: string | null;
    logo_url: string | null;
    accent_color: string | null;
  }
  const customerRaw = unwrapEmbed(
    proposal.customers as CustomerBrandRow | CustomerBrandRow[] | null,
  );
  const customer = customerRaw
    ? {
        name: customerRaw.name ?? null,
        logoUrl: customerRaw.logo_url ?? null,
        accentColor: customerRaw.accent_color ?? null,
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

      {/* The document, exactly as the client's sign page renders it — pinned to
          the proposal's chosen theme (data-theme overrides the dashboard theme
          for this subtree), so the author previews the real client look while
          the chrome above stays in their own theme. */}
      <div
        data-theme={resolveSignTheme(proposal.sign_theme)}
        className="rounded-lg border border-edge bg-surface p-[24px]"
      >
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
          signers={signers}
        />
      </div>
    </div>
  );
}
