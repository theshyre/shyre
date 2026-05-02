"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import { paymentTermsLabel } from "@/lib/payment-terms";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoiceNumber: string | null;
  customerName: string | null;
  issuedDate: string;
  dueDate: string;
  paymentTermsDays: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: LineItem[];
  subtotal: number;
  discountAmount: number;
  discountRate: number | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  businessName: string | null;
}

/**
 * Full-invoice preview modal.
 *
 * Renders an HTML version of what the invoice will look like once
 * created — line items table, customer block, dates / period,
 * totals, notes. Mirrors the structure of `InvoicePDF` so what the
 * user sees here matches what the customer eventually receives.
 *
 * Why HTML and not the actual PDF (via @react-pdf/renderer's
 * PDFViewer): the PDF renderer is heavy on first open (loads fonts,
 * boots the wasm-style canvas), and the user's primary need here is
 * "does the line-item layout look right?" — answered without paying
 * the PDF render cost. The downloaded PDF is a click away after
 * creating, and the dedicated PAID/VOID watermark logic for the
 * detail page is also not needed for a draft preview.
 *
 * Accessibility: role="dialog", aria-modal, Escape closes, click
 * outside the panel closes. Focus trap is intentionally NOT
 * implemented — same level of trap as split-expense-modal, which
 * the codebase already ships.
 */
export function InvoicePreviewModal({
  open,
  onClose,
  invoiceNumber,
  customerName,
  issuedDate,
  dueDate,
  paymentTermsDays,
  periodStart,
  periodEnd,
  lines,
  subtotal,
  discountAmount,
  discountRate,
  taxRate,
  taxAmount,
  total,
  notes,
  businessName,
}: Props): React.JSX.Element | null {
  const t = useTranslations("invoices");
  const tNew = useTranslations("invoices.new");
  const tCommon = useTranslations("common");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof window === "undefined") return null;

  const termsLabel = paymentTermsLabel(paymentTermsDays);
  const dueDateText =
    dueDate && termsLabel ? `${dueDate} (${termsLabel})` : dueDate || "—";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-content/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[800px] max-h-[90vh] overflow-y-auto rounded-lg border border-edge bg-surface-raised shadow-lg">
        {/* Modal chrome — title + close button. Not part of the
            invoice itself; visually separated by border so the
            preview body reads as a self-contained document. */}
        <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-3">
          <div>
            <h2
              id="invoice-preview-title"
              className="text-title font-semibold text-content"
            >
              {tNew("preview.fullModalTitle")}
            </h2>
            <p className="mt-0.5 text-caption text-content-muted">
              {tNew("preview.fullModalSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("actions.close")}
            className="inline-flex items-center rounded-md p-1 text-content-muted hover:bg-hover hover:text-content"
          >
            <X size={16} />
          </button>
        </div>

        {/* Invoice body. Mirrors the structure of `InvoicePDF` —
            same section ordering and similar typographic rhythm —
            so the customer's eventual PDF closely resembles this
            draft view. */}
        <div className="p-6 space-y-5 bg-surface text-content">
          {/* Header: business + invoice number */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-body-lg font-semibold">
                {businessName ?? tNew("preview.fullBusinessFallback")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-caption uppercase tracking-wider text-content-muted">
                {t("title")}
              </p>
              <p className="text-title font-semibold">
                {invoiceNumber ?? "—"}
              </p>
            </div>
          </div>

          {/* Customer + dates */}
          <div className="grid gap-4 sm:grid-cols-2 border-y border-edge py-4">
            <div>
              <p className="text-caption uppercase tracking-wider text-content-muted mb-1">
                {tNew("preview.fullBillTo")}
              </p>
              <p className="text-body font-medium">
                {customerName ?? tNew("preview.fullCustomerFallback")}
              </p>
            </div>
            <div className="space-y-1 text-body">
              <div className="flex justify-between gap-3">
                <span className="text-content-muted">
                  {t("pdf.date")}
                </span>
                <span className="font-mono tabular-nums">
                  {issuedDate || "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-content-muted">
                  {t("pdf.dueDate")}
                </span>
                <span className="font-mono tabular-nums">
                  {dueDateText}
                </span>
              </div>
              {(periodStart || periodEnd) && (
                <div className="flex justify-between gap-3 text-caption">
                  <span className="text-content-muted">
                    {t("servicePeriod")}
                  </span>
                  <span className="font-mono tabular-nums text-content-secondary">
                    {periodStart ?? "—"} → {periodEnd ?? "—"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div>
            {lines.length === 0 ? (
              <p className="text-body text-content-muted italic py-6 text-center">
                {tNew("preview.fullNoLines")}
              </p>
            ) : (
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-edge text-label uppercase tracking-wider text-content-muted">
                    <th className="text-left py-2">
                      {tNew("preview.fullColDescription")}
                    </th>
                    <th className="text-right py-2 w-20">
                      {tNew("preview.fullColQty")}
                    </th>
                    <th className="text-right py-2 w-24">
                      {tNew("preview.fullColRate")}
                    </th>
                    <th className="text-right py-2 w-28">
                      {tNew("preview.fullColAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-b border-edge last:border-0">
                      <td className="py-2 align-top">{line.description}</td>
                      <td className="py-2 text-right font-mono tabular-nums align-top">
                        {line.quantity.toFixed(2)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums align-top">
                        {formatCurrency(line.unitPrice)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums align-top">
                        {formatCurrency(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Totals — flush right, sized to match the PDF totals
              block. Discount + tax rows render conditionally so a
              simple invoice doesn't show empty zero rows. */}
          {lines.length > 0 && (
            <div className="flex justify-end">
              <div className="w-full max-w-[320px] space-y-1.5 text-body">
                <div className="flex justify-between">
                  <span className="text-content-muted">
                    {t("fields.subtotal")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(subtotal)}
                  </span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-content-muted">
                      {t("fields.discount")}
                      {discountRate !== null ? ` (${discountRate}%)` : ""}
                    </span>
                    <span className="font-mono tabular-nums">
                      −{formatCurrency(discountAmount)}
                    </span>
                  </div>
                )}
                {taxRate > 0 && (
                  <div className="flex justify-between">
                    <span className="text-content-muted">
                      {t("fields.taxAmount")} ({taxRate}%)
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(taxAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-edge pt-1.5 text-body-lg font-semibold">
                  <span>{t("fields.total")}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {notes && (
            <div className="border-t border-edge pt-3">
              <p className="text-caption uppercase tracking-wider text-content-muted mb-1">
                {t("fields.notes")}
              </p>
              <p className="text-body whitespace-pre-line">{notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
