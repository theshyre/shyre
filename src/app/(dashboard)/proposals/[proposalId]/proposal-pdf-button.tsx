"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { ProposalPDF, type ProposalPDFItem } from "@/components/ProposalPDF";
import { buttonSecondaryClass } from "@/lib/form-styles";

export interface ProposalPdfBundle {
  proposal: {
    proposal_number: string;
    title: string;
    issued_date: string | null;
    valid_until: string | null;
    payment_terms_label: string | null;
    deposit_type: "none" | "percent" | "amount";
    deposit_value: number | null;
    warranty_days: number | null;
    terms_notes: string | null;
    currency: string | null;
  };
  items: ProposalPDFItem[];
  total: number;
  client: {
    name: string;
    email: string | null;
    address: string | null;
    show_country_on_invoice: boolean | null;
  } | null;
  signerName: string | null;
  business: {
    business_name: string | null;
    business_email: string | null;
    business_address: string | null;
    business_phone: string | null;
    wordmark_primary: string | null;
    wordmark_secondary: string | null;
    brand_color: string | null;
    show_country_on_invoice: boolean | null;
  } | null;
}

/** Client-side PDF render + download, mirroring InvoicePdfButton: the
 *  document is generated in the browser and never persisted. */
export function ProposalPdfButton({
  bundle,
}: {
  bundle: ProposalPdfBundle;
}): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const { proposal, items, total, client, signerName, business } = bundle;
  const [busy, setBusy] = useState(false);

  async function handleDownload(): Promise<void> {
    const doc = (
      <ProposalPDF
        proposalNumber={proposal.proposal_number}
        title={proposal.title}
        issuedDate={proposal.issued_date}
        validUntil={proposal.valid_until}
        paymentTermsLabel={proposal.payment_terms_label}
        depositType={proposal.deposit_type}
        depositValue={
          proposal.deposit_value != null ? Number(proposal.deposit_value) : null
        }
        warrantyDays={proposal.warranty_days}
        termsNotes={proposal.terms_notes}
        total={total}
        currency={proposal.currency ?? "USD"}
        business={{
          name: business?.business_name ?? null,
          email: business?.business_email ?? null,
          address: business?.business_address ?? null,
          phone: business?.business_phone ?? null,
          wordmarkPrimary: business?.wordmark_primary ?? null,
          wordmarkSecondary: business?.wordmark_secondary ?? null,
          brandColor: business?.brand_color ?? null,
          showCountry: business?.show_country_on_invoice ?? false,
        }}
        client={{
          name: client?.name ?? "—",
          email: client?.email ?? null,
          address: client?.address ?? null,
          showCountry: client?.show_country_on_invoice ?? false,
        }}
        signerName={signerName}
        items={items}
      />
    );
    // Rendering a large PDF to a blob takes a beat — surface pending state
    // rather than letting the button look inert (per the forms/buttons rule).
    setBusy(true);
    try {
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${proposal.proposal_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={buttonSecondaryClass}
      disabled={busy}
      onClick={() => void handleDownload()}
    >
      {busy ? (
        <Loader2 size={16} aria-hidden="true" className="animate-spin" />
      ) : (
        <Download size={16} aria-hidden="true" />
      )}
      {busy ? t("downloadPdfPending") : t("downloadPdf")}
    </button>
  );
}
