import { effectiveInvoiceStatus } from "@/lib/invoice-status";

/**
 * Pure helpers for building the invoice CSV export. Lives outside
 * the route handler so the row → CSV row mapping is unit-testable
 * without spinning up Supabase.
 */

export interface InvoiceCsvRowInput {
  invoice_number: string;
  status: string | null;
  issued_date: string | null;
  due_date: string | null;
  subtotal: number | string | null;
  tax_rate: number | string | null;
  tax_amount: number | string | null;
  total: number | string | null;
  currency: string | null;
  notes: string | null;
  imported_from: string | null;
  team_id: string;
  customer_name: string;
}

export interface InvoiceCsvRow {
  invoice_number: string;
  team: string;
  customer: string;
  status: string;
  issued_date: string;
  due_date: string;
  currency: string;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  imported_from: string;
  notes: string;
}

export const INVOICE_CSV_HEADERS: ReadonlyArray<keyof InvoiceCsvRow> = [
  "invoice_number",
  "team",
  "customer",
  "status",
  "issued_date",
  "due_date",
  "currency",
  "subtotal",
  "tax_rate",
  "tax_amount",
  "total",
  "imported_from",
  "notes",
];

/** Convert a raw invoice row (joined with customer name + team
 *  context) into the export-shaped CSV row. The status column
 *  reflects the *effective* status (sent past-due → overdue) so the
 *  spreadsheet matches what the page shows.
 *
 *  Pure function — `today` and `teamNameById` are passed in so the
 *  caller controls them and tests can pin them to a fixed value. */
export function buildInvoiceCsvRow(
  input: InvoiceCsvRowInput,
  teamNameById: Map<string, string>,
  today: string,
): InvoiceCsvRow {
  const displayStatus = effectiveInvoiceStatus(
    input.status ?? "draft",
    input.due_date,
    today,
  );
  return {
    invoice_number: input.invoice_number,
    team: teamNameById.get(input.team_id) ?? "",
    customer: input.customer_name,
    status: displayStatus,
    issued_date: input.issued_date ?? "",
    due_date: input.due_date ?? "",
    currency: (input.currency ?? "USD").toUpperCase(),
    subtotal: input.subtotal !== null && input.subtotal !== undefined
      ? String(input.subtotal)
      : "",
    tax_rate: input.tax_rate !== null && input.tax_rate !== undefined
      ? String(input.tax_rate)
      : "",
    tax_amount: input.tax_amount !== null && input.tax_amount !== undefined
      ? String(input.tax_amount)
      : "",
    total: input.total !== null && input.total !== undefined
      ? String(input.total)
      : "",
    imported_from: input.imported_from ?? "",
    notes: input.notes ?? "",
  };
}
