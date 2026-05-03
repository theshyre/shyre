/**
 * Variable catalog rendered in the settings + send-modal sidebar.
 * Mirrors `lookup()` in render.ts — adding a variable requires a
 * row here, a case in render.ts, and a property on the call site's
 * VariableBag construction.
 */

export interface VariableSpec {
  /** What goes between the `%` signs. */
  key: string;
  /** Short label shown in the UI. */
  label: string;
  /** One-line description shown next to the chip in the sidebar. */
  description: string;
  /** Which message kinds this variable is meaningful for. Hidden in
   *  the sidebar for kinds that don't supply it. */
  kinds: ReadonlyArray<"invoice_send" | "invoice_reminder" | "payment_thanks">;
}

const ALL_KINDS = [
  "invoice_send",
  "invoice_reminder",
  "payment_thanks",
] as const;
const REMINDER_ONLY = ["invoice_reminder"] as const;

export const TEMPLATE_VARIABLES: ReadonlyArray<VariableSpec> = [
  {
    key: "invoice_id",
    label: "Invoice ID",
    description: "Invoice number (e.g. INV-2026-143)",
    kinds: ALL_KINDS,
  },
  {
    key: "invoice_amount",
    label: "Amount due",
    description: "Total balance owed on the invoice",
    kinds: ALL_KINDS,
  },
  {
    key: "invoice_payment_total",
    label: "Payments received",
    description: "Sum of payments recorded against the invoice",
    kinds: ALL_KINDS,
  },
  {
    key: "invoice_issue_date",
    label: "Issue date",
    description: "Date the invoice was issued",
    kinds: ALL_KINDS,
  },
  {
    key: "invoice_due_date",
    label: "Due date",
    description: "Date the invoice is due",
    kinds: ALL_KINDS,
  },
  {
    key: "invoice_payment_terms",
    label: "Payment terms",
    description: "Frozen label like \"Net 30\" or \"Due on receipt\"",
    kinds: ALL_KINDS,
  },
  {
    key: "invoice_url",
    label: "Invoice link",
    description: "Hosted page link the customer can open in any browser",
    kinds: ALL_KINDS,
  },
  {
    key: "customer_name",
    label: "Customer name",
    description: "Receiving customer / client name",
    kinds: ALL_KINDS,
  },
  {
    key: "company_name",
    label: "Your company",
    description: "Your business name as configured in team settings",
    kinds: ALL_KINDS,
  },
  {
    key: "customer_po_number",
    label: "PO number",
    description: "Customer's PO number, if set on the invoice",
    kinds: ALL_KINDS,
  },
  {
    key: "days_past_due",
    label: "Days past due",
    description: "How many days the invoice is overdue (reminders only)",
    kinds: REMINDER_ONLY,
  },
  {
    key: "days_until_due",
    label: "Days until due",
    description: "How many days remain before the due date (pre-due reminders)",
    kinds: REMINDER_ONLY,
  },
];
