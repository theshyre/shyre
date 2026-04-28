"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";
import { buttonPrimaryClass } from "@/lib/form-styles";

interface InvoicePdfButtonProps {
  invoice: {
    invoice_number: string;
    issued_date: string | null;
    due_date: string | null;
    notes: string | null;
    subtotal: number | null;
    tax_rate: number | null;
    tax_amount: number | null;
    total: number | null;
    currency: string | null;
  };
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  client: {
    name: string;
    email: string | null;
    address: string | null;
  } | null;
  business: {
    business_name: string | null;
    business_email: string | null;
    business_address: string | null;
    business_phone: string | null;
  } | null;
}

export function InvoicePdfButton({
  invoice,
  lineItems,
  client,
  business,
}: InvoicePdfButtonProps): React.JSX.Element {
  const t = useTranslations("invoices.actions");

  async function handleDownload(): Promise<void> {
    const doc = (
      <InvoicePDF
        invoiceNumber={invoice.invoice_number}
        issuedDate={invoice.issued_date}
        dueDate={invoice.due_date}
        notes={invoice.notes}
        subtotal={Number(invoice.subtotal ?? 0)}
        taxRate={Number(invoice.tax_rate ?? 0)}
        taxAmount={Number(invoice.tax_amount ?? 0)}
        total={Number(invoice.total ?? 0)}
        currency={invoice.currency ?? "USD"}
        business={{
          name: business?.business_name ?? null,
          email: business?.business_email ?? null,
          address: business?.business_address ?? null,
          phone: business?.business_phone ?? null,
        }}
        client={{
          name: client?.name ?? "Client",
          email: client?.email ?? null,
          address: client?.address ?? null,
        }}
        lineItems={lineItems.map((li) => ({
          description: li.description,
          quantity: Number(li.quantity),
          unitPrice: Number(li.unit_price),
          amount: Number(li.amount),
        }))}
      />
    );

    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice.invoice_number}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button onClick={handleDownload} className={buttonPrimaryClass}>
      <Download size={16} />
      {t("downloadPdf")}
    </button>
  );
}
