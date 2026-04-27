import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { formatDate } from "@theshyre/ui";
import { formatCurrency } from "@/lib/invoice-utils";
import { InvoiceActions } from "./invoice-actions";
import { InvoicePdfButton } from "./invoice-pdf-button";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("invoices");

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, customers(name, email, address)")
    .eq("id", id)
    .single();

  if (!invoice) notFound();

  const { data: lineItems } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", id)
    .order("id");

  const { data: settings } = await supabase
    .from("team_settings")
    .select("business_name, business_email, business_address, business_phone")
    .eq("team_id", invoice.team_id)
    .single();

  const client =
    invoice.customers && typeof invoice.customers === "object"
      ? (invoice.customers as { name: string; email: string | null; address: string | null })
      : null;

  const statusColorMap: Record<string, string> = {
    draft: "bg-surface-inset text-content-muted",
    sent: "bg-info-soft text-info",
    paid: "bg-success-soft text-success",
    overdue: "bg-error-soft text-error",
    void: "bg-surface-inset text-content-muted",
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-accent" />
          <h1 className="text-2xl font-bold text-content font-mono">
            {invoice.invoice_number}
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorMap[invoice.status ?? "draft"] ?? ""}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t(`status.${invoice.status ?? "draft"}`)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <InvoicePdfButton
            invoice={invoice}
            lineItems={lineItems ?? []}
            client={client}
            business={settings}
          />
          <InvoiceActions invoiceId={invoice.id} currentStatus={invoice.status ?? "draft"} />
        </div>
      </div>

      {/* Invoice details */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-edge bg-surface-raised p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("pdf.billTo")}
          </h3>
          <p className="font-medium text-content">{client?.name ?? "—"}</p>
          {client?.email && (
            <p className="text-sm text-content-secondary">{client.email}</p>
          )}
          {client?.address && (
            <p className="text-sm text-content-secondary">{client.address}</p>
          )}
        </div>
        <div className="rounded-lg border border-edge bg-surface-raised p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("pdf.from")}
          </h3>
          <p className="font-medium text-content">
            {settings?.business_name ?? "—"}
          </p>
          {settings?.business_email && (
            <p className="text-sm text-content-secondary">
              {settings.business_email}
            </p>
          )}
          {settings?.business_address && (
            <p className="text-sm text-content-secondary">
              {settings.business_address}
            </p>
          )}
        </div>
      </div>

      {/* Dates */}
      <div className="mt-4 flex gap-6 text-sm text-content-secondary">
        <div>
          <span className="text-content-muted">{t("pdf.date")}:</span>{" "}
          {invoice.issued_date
            ? formatDate(invoice.issued_date)
            : "—"}
        </div>
        <div>
          <span className="text-content-muted">{t("pdf.dueDate")}:</span>{" "}
          {invoice.due_date
            ? formatDate(invoice.due_date)
            : "—"}
        </div>
      </div>

      {/* Line items table */}
      <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge bg-surface-inset">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.description")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.hours")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.rate")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {(lineItems ?? []).map((item) => (
              <tr
                key={item.id}
                className="border-b border-edge last:border-0"
              >
                <td className="px-4 py-3 text-content">
                  {item.description}
                </td>
                <td className="px-4 py-3 text-right font-mono text-content-secondary">
                  {Number(item.quantity).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-content-secondary">
                  {formatCurrency(Number(item.unit_price))}
                </td>
                <td className="px-4 py-3 text-right font-mono text-content">
                  {formatCurrency(Number(item.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="border-t border-edge bg-surface-inset px-4 py-3">
          <div className="flex justify-end gap-[32px]">
            <div className="text-right space-y-1">
              <p className="text-sm text-content-muted">
                {t("fields.subtotal")}
              </p>
              <p className="text-sm text-content-muted">
                {t("fields.taxAmount")} ({Number(invoice.tax_rate)}%)
              </p>
              <p className="text-sm font-semibold text-content">
                {t("fields.total")}
              </p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm font-mono text-content-secondary">
                {formatCurrency(Number(invoice.subtotal))}
              </p>
              <p className="text-sm font-mono text-content-secondary">
                {formatCurrency(Number(invoice.tax_amount))}
              </p>
              <p className="text-sm font-mono font-semibold text-content">
                {formatCurrency(Number(invoice.total))}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="mt-4 rounded-lg border border-edge bg-surface-raised p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("pdf.notes")}
          </h3>
          <p className="text-sm text-content-secondary whitespace-pre-wrap">
            {invoice.notes}
          </p>
        </div>
      )}
    </div>
  );
}
