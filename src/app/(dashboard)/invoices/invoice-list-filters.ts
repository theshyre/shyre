import type { InvoiceStatus } from "@/lib/invoice-status";

/**
 * Server-safe filter model for the invoices list. Lives OUTSIDE the
 * "use client" filter components on purpose: the server page calls
 * hasActiveInvoiceFilters() while building its query/empty state, and a
 * client-module export is not callable from a server component (the
 * 2026-07-19 /invoices outage — runtime-only error the build gate does
 * not catch).
 */
export interface InvoiceListFilters {
  status: InvoiceStatus | null;
  customerId: string | null;
  from: string | null;
  to: string | null;
}

export function hasActiveInvoiceFilters(
  filters: InvoiceListFilters,
): boolean {
  return (
    filters.status !== null ||
    filters.customerId !== null ||
    filters.from !== null ||
    filters.to !== null
  );
}
