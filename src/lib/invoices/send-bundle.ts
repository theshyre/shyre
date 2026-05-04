import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  groupEntriesIntoLineItems,
  type EntryCandidate,
} from "@/lib/invoice-grouping";
import { renderTemplate, type VariableBag } from "@/lib/messaging/render";

/**
 * Server-side loader for everything the Send Invoice route needs to
 * compose, preview, render the PDF, and dispatch the email.
 *
 * Lives separately from the invoice detail page's own data path so
 * the send route can stand on its own (no PDF bundle handed across
 * a portal, no duplicated invoice fetch when a user navigates
 * straight to /invoices/[id]/send via an email link).
 *
 * Parallels the same template / variable-bag rendering the invoice
 * detail page does inline. If both surfaces start to diverge, this
 * helper is the place to stabilize.
 */

export interface InvoiceSendBundle {
  invoiceId: string;
  teamId: string;
  invoiceNumber: string;
  status: string;
  /** Pre-resolved subject + body (variables already substituted). */
  renderedSubject: string;
  renderedBody: string;
  /** Default To: pre-fill — joined recipient contacts, falling back
   *  to customers.email. Empty string when nothing is known. */
  defaultTo: string;
  /** Email-config presence flags so the form can show the demoted /
   *  "set up first" state without a client-side roundtrip. */
  configMissing: boolean;
  domainNotVerified: boolean;
  fromEmail: string | null;
  fromName: string | null;
  replyTo: string | null;
  signature: string;
  /** Everything the @react-pdf/renderer document consumes when the
   *  client builds the PDF blob right before send. */
  pdfBundle: PdfBundle;
}

export interface PdfBundle {
  invoice: Record<string, unknown>;
  lineItems: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  client: {
    name: string;
    email: string | null;
    address: string | null;
    show_country_on_invoice: boolean | null;
  } | null;
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
  paymentsTotal: number;
  invoiceNumber: string;
  paymentTermsLabel: string | null;
}

const DEFAULT_SUBJECT = "Invoice %invoice_id% from %company_name%";
const DEFAULT_BODY = `Hello,

Please find invoice %invoice_id% attached.

Invoice ID: %invoice_id%
Issue date: %invoice_issue_date%
Customer: %customer_name%
Amount: %invoice_amount%
Due: %invoice_due_date% (%invoice_payment_terms%)

Thanks,
%company_name%`;

export async function loadInvoiceSendBundle(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceSendBundle | null> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "*, customers(id, name, email, address, show_country_on_invoice)",
    )
    .eq("id", invoiceId)
    .single();
  if (!invoice) return null;

  const customerId =
    invoice.customers &&
    typeof invoice.customers === "object" &&
    "id" in invoice.customers
      ? ((invoice.customers as { id: string }).id ?? null)
      : null;

  const [
    { data: recipientContacts },
    { data: lineItems },
    { data: settings },
    { data: payments },
    { data: invoicedEntries },
    { data: emailConfig },
    { data: emailDomains },
    { data: emailTemplate },
  ] = await Promise.all([
    customerId
      ? supabase
          .from("customer_contacts")
          .select("email")
          .eq("customer_id", customerId)
          .eq("is_invoice_recipient", true)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as { email: string | null }[] }),
    supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("id"),
    supabase
      .from("team_settings")
      .select(
        "business_name, business_email, business_address, business_phone, wordmark_primary, wordmark_secondary, brand_color, show_country_on_invoice",
      )
      .eq("team_id", invoice.team_id)
      .single(),
    supabase
      .from("invoice_payments")
      .select("amount")
      .eq("invoice_id", invoiceId),
    supabase
      .from("time_entries")
      .select(
        "id, user_id, duration_min, description, start_time, projects(name, invoice_code, hourly_rate, customers(default_rate)), categories(name)",
      )
      .eq("invoice_id", invoiceId),
    supabase
      .from("team_email_config")
      .select(
        "from_email, from_name, reply_to_email, signature, api_key_encrypted",
      )
      .eq("team_id", invoice.team_id)
      .maybeSingle(),
    supabase
      .from("verified_email_domains")
      .select("domain, status")
      .eq("team_id", invoice.team_id),
    supabase
      .from("message_templates")
      .select("subject, body")
      .eq("team_id", invoice.team_id)
      .eq("kind", "invoice_send")
      .maybeSingle(),
  ]);

  const recipientEmails = (recipientContacts ?? [])
    .map((c) => (c.email as string | null) ?? "")
    .filter((e) => e.length > 0);
  const customerEmail =
    invoice.customers &&
    typeof invoice.customers === "object" &&
    "email" in invoice.customers
      ? ((invoice.customers as { email: string | null }).email ?? null)
      : null;
  const defaultTo =
    recipientEmails.length > 0
      ? recipientEmails.join(", ")
      : (customerEmail ?? "");

  // Re-derive line items from source time entries (same logic the
  // invoice detail page uses) so the PDF reflects the [code] /
  // per-line-date format whether or not the row was migrated.
  const resolvedLineItems = (() => {
    const sourceEntries = invoicedEntries ?? [];
    if (sourceEntries.length === 0) {
      return (lineItems ?? []).map((li) => ({
        description: (li.description as string) ?? "",
        quantity: Number(li.quantity ?? 0),
        unit_price: Number(li.unit_price ?? 0),
        amount: Number(li.amount ?? 0),
      }));
    }
    interface SrcRow {
      id: string;
      user_id: string | null;
      duration_min: number | null;
      description: string | null;
      start_time: string | null;
      projects: {
        name: string | null;
        invoice_code: string | null;
        hourly_rate: number | null;
        customers: { default_rate: number | null } | null;
      } | null;
      categories: { name: string | null } | null;
    }
    const candidates: EntryCandidate[] = sourceEntries.map((row) => {
      const r = row as unknown as SrcRow;
      const proj = r.projects ?? null;
      const rate =
        (proj?.hourly_rate != null ? Number(proj.hourly_rate) : null) ??
        (proj?.customers?.default_rate != null
          ? Number(proj.customers.default_rate)
          : null) ??
        0;
      return {
        id: r.id,
        durationMin: Number(r.duration_min ?? 0),
        rate,
        description: r.description,
        projectName: proj?.name ?? "Project",
        projectInvoiceCode: proj?.invoice_code ?? null,
        taskName: r.categories?.name ?? null,
        personName: r.user_id ?? "Unknown",
        date:
          r.start_time && r.start_time.length >= 10
            ? r.start_time.slice(0, 10)
            : "",
      };
    });
    const groupingMode = (invoice.grouping_mode as
      | "by_project"
      | "by_task"
      | "by_person"
      | "detailed"
      | null) ?? "by_project";
    const grouped = groupEntriesIntoLineItems(candidates, groupingMode);
    return grouped.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      amount: line.amount,
    }));
  })();

  const paymentsTotal = (payments ?? []).reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0,
  );

  const totalNum = Number(invoice.total ?? 0);
  const fmtCurrency = (n: number): string =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (invoice.currency as string | null) ?? "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  const fmtDate = (iso: string | null): string => {
    if (!iso) return "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
  };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const variableBag: VariableBag = {
    invoiceId: (invoice.invoice_number as string | null) ?? null,
    invoiceUrl: baseUrl ? `${baseUrl}/invoices/${invoice.id}` : null,
    invoiceAmount: fmtCurrency(totalNum),
    invoicePaymentTotal: fmtCurrency(paymentsTotal),
    invoiceIssueDate: fmtDate(invoice.issued_date as string | null),
    invoiceDueDate: fmtDate(invoice.due_date as string | null),
    invoicePaymentTermsLabel:
      (invoice.payment_terms_label as string | null) ?? null,
    customerName:
      invoice.customers &&
      typeof invoice.customers === "object" &&
      "name" in invoice.customers
        ? ((invoice.customers as { name: string }).name ?? null)
        : null,
    customerPoNumber: null,
    companyName: (settings?.business_name as string | null) ?? null,
    daysPastDue: null,
    daysUntilDue: null,
  };
  const tplSubject =
    (emailTemplate?.subject as string | null) ?? DEFAULT_SUBJECT;
  const tplBody = (emailTemplate?.body as string | null) ?? DEFAULT_BODY;
  const renderedSubject = renderTemplate(tplSubject, variableBag);
  const renderedBody = renderTemplate(tplBody, variableBag);

  const fromEmail = (emailConfig?.from_email as string | null) ?? null;
  const fromDomain = fromEmail
    ? fromEmail.slice(fromEmail.lastIndexOf("@") + 1).toLowerCase()
    : null;
  const domainVerified = Boolean(
    fromDomain &&
      (emailDomains ?? []).some(
        (d) =>
          (d.domain as string).toLowerCase() === fromDomain &&
          d.status === "verified",
      ),
  );
  const configMissing = !(emailConfig?.api_key_encrypted && fromEmail);

  const client =
    invoice.customers && typeof invoice.customers === "object"
      ? (invoice.customers as {
          name: string;
          email: string | null;
          address: string | null;
          show_country_on_invoice: boolean | null;
        })
      : null;

  return {
    invoiceId: invoice.id as string,
    teamId: invoice.team_id as string,
    invoiceNumber: (invoice.invoice_number as string | null) ?? "",
    status: (invoice.status as string | null) ?? "draft",
    renderedSubject,
    renderedBody,
    defaultTo,
    configMissing,
    domainNotVerified: !configMissing && !domainVerified,
    fromEmail,
    fromName: (emailConfig?.from_name as string | null) ?? null,
    replyTo: (emailConfig?.reply_to_email as string | null) ?? null,
    signature: (emailConfig?.signature as string | null) ?? "",
    pdfBundle: {
      invoice: invoice as Record<string, unknown>,
      lineItems: resolvedLineItems,
      client,
      business: settings ?? null,
      paymentsTotal,
      invoiceNumber: (invoice.invoice_number as string | null) ?? "",
      paymentTermsLabel:
        (invoice.payment_terms_label as string | null) ?? null,
    },
  };
}
