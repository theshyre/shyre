import { effectiveInvoiceStatus } from "@/lib/invoice-status";

/**
 * Pure helpers for building the invoice CSV export. Lives outside
 * the route handler so the row → CSV row mapping is unit-testable
 * without spinning up Supabase.
 *
 * Reconciliation columns (invoice_id, sent_at, paid_at, voided_at,
 * payments_total, amount_due, customer_email, discount_*, period_*)
 * let bookkeepers tie an exported row back to a database record and
 * to a payment register. Without them the export is opaque at audit.
 */

export interface InvoiceCsvRowInput {
  id: string;
  invoice_number: string;
  status: string | null;
  issued_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  subtotal: number | string | null;
  tax_rate: number | string | null;
  tax_amount: number | string | null;
  discount_rate: number | string | null;
  discount_amount: number | string | null;
  total: number | string | null;
  payments_total: number;
  currency: string | null;
  notes: string | null;
  imported_from: string | null;
  team_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
}

export interface InvoiceCsvRow {
  invoice_id: string;
  invoice_number: string;
  team: string;
  customer: string;
  customer_email: string;
  status: string;
  issued_date: string;
  due_date: string;
  sent_at: string;
  paid_at: string;
  voided_at: string;
  currency: string;
  subtotal: string;
  discount_rate: string;
  discount_amount: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  payments_total: string;
  amount_due: string;
  imported_from: string;
  notes: string;
  customer_id: string;
  team_id: string;
}

export const INVOICE_CSV_HEADERS: ReadonlyArray<keyof InvoiceCsvRow> = [
  "invoice_id",
  "invoice_number",
  "team",
  "customer",
  "customer_email",
  "status",
  "issued_date",
  "due_date",
  "sent_at",
  "paid_at",
  "voided_at",
  "currency",
  "subtotal",
  "discount_rate",
  "discount_amount",
  "tax_rate",
  "tax_amount",
  "total",
  "payments_total",
  "amount_due",
  "imported_from",
  "notes",
  "customer_id",
  "team_id",
];

function moneyOrEmpty(v: number | string | null | undefined): string {
  return v !== null && v !== undefined ? String(v) : "";
}

function moneyToNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Convert a raw invoice row (joined with customer name + team
 *  context + payments_total) into the export-shaped CSV row. The
 *  status column reflects the *effective* status (sent past-due →
 *  overdue) so the spreadsheet matches what the page shows.
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
  const totalNumber = moneyToNumber(input.total);
  const amountDue = totalNumber - input.payments_total;
  return {
    invoice_id: input.id,
    invoice_number: input.invoice_number,
    team: teamNameById.get(input.team_id) ?? "",
    customer: input.customer_name,
    customer_email: input.customer_email ?? "",
    status: displayStatus,
    issued_date: input.issued_date ?? "",
    due_date: input.due_date ?? "",
    sent_at: input.sent_at ?? "",
    paid_at: input.paid_at ?? "",
    voided_at: input.voided_at ?? "",
    currency: (input.currency ?? "USD").toUpperCase(),
    subtotal: moneyOrEmpty(input.subtotal),
    discount_rate: moneyOrEmpty(input.discount_rate),
    discount_amount: moneyOrEmpty(input.discount_amount),
    tax_rate: moneyOrEmpty(input.tax_rate),
    tax_amount: moneyOrEmpty(input.tax_amount),
    total: moneyOrEmpty(input.total),
    payments_total: input.payments_total.toFixed(2),
    amount_due: amountDue.toFixed(2),
    imported_from: input.imported_from ?? "",
    notes: input.notes ?? "",
    customer_id: input.customer_id ?? "",
    team_id: input.team_id,
  };
}
