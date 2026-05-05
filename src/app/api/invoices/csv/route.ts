import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import { logError } from "@/lib/logger";
import {
  buildInvoiceCsvRow,
  INVOICE_CSV_HEADERS,
} from "@/app/(dashboard)/invoices/invoice-csv";

/**
 * GET /api/invoices/csv
 *
 * Streams the invoice list as CSV — one row per invoice, columns
 * mirror the visible table plus reconciliation fields (invoice_id,
 * sent_at, paid_at, voided_at, payments_total, amount_due,
 * customer_email, discount_*) for accountant handoff. Honors the
 * same filters as the page (`org`, `status`, `customerId`, `from`, `to`).
 *
 * Authorization is gated by RLS — owner|admin only after SAL-011.
 * The customer-admin escape on `invoices_select` still applies.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const teamId = url.searchParams.get("org");
  const status = url.searchParams.get("status");
  const customerId = url.searchParams.get("customerId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = supabase
    .from("invoices")
    .select(
      "id, invoice_number, status, issued_date, due_date, sent_at, paid_at, voided_at, subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total, currency, notes, imported_from, customer_id, customers(name, email), team_id",
    )
    .order("issued_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (teamId) query = query.eq("team_id", teamId);
  if (status) query = query.eq("status", status);
  if (customerId) query = query.eq("customer_id", customerId);
  if (from) query = query.gte("issued_date", from);
  if (to) query = query.lte("issued_date", to);

  const { data: rows, error } = await query;
  if (error) {
    logError(error, {
      userId: user.id,
      teamId: teamId ?? undefined,
      url: "/api/invoices/csv",
      action: "exportInvoices",
    });
    return new Response("Export failed", { status: 500 });
  }

  // Look up team names in one query so the CSV's "team" column
  // shows a name not a UUID.
  const teamIds = Array.from(
    new Set((rows ?? []).map((r) => r.team_id as string)),
  );
  const teamNameById = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIds);
    for (const t of teams ?? []) {
      teamNameById.set(t.id as string, (t.name as string) ?? "");
    }
  }

  // Sum payments per invoice in one query so amount_due reconciles
  // against the AR-aging report.
  const invoiceIds = (rows ?? []).map((r) => r.id as string);
  const paymentsTotalById = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: payments, error: paymentsErr } = await supabase
      .from("invoice_payments")
      .select("invoice_id, amount")
      .in("invoice_id", invoiceIds);
    if (paymentsErr) {
      logError(paymentsErr, {
        userId: user.id,
        teamId: teamId ?? undefined,
        url: "/api/invoices/csv",
        action: "exportInvoices.payments",
      });
    }
    for (const p of payments ?? []) {
      const id = p.invoice_id as string;
      const amount = Number(p.amount ?? 0);
      paymentsTotalById.set(
        id,
        (paymentsTotalById.get(id) ?? 0) + (Number.isFinite(amount) ? amount : 0),
      );
    }
  }

  const today = todayUtcDate();

  const lines: string[] = [
    INVOICE_CSV_HEADERS.map((h) => escapeCsvField(h)).join(","),
  ];

  for (const row of rows ?? []) {
    const customer =
      row.customers && typeof row.customers === "object"
        ? (row.customers as { name?: string; email?: string | null })
        : null;
    const customerName = customer?.name ?? "";
    const customerEmail = customer?.email ?? null;
    const csvRow = buildInvoiceCsvRow(
      {
        id: row.id as string,
        invoice_number: row.invoice_number as string,
        status: (row.status as string | null) ?? null,
        issued_date: (row.issued_date as string | null) ?? null,
        due_date: (row.due_date as string | null) ?? null,
        sent_at: (row.sent_at as string | null) ?? null,
        paid_at: (row.paid_at as string | null) ?? null,
        voided_at: (row.voided_at as string | null) ?? null,
        subtotal: row.subtotal as number | string | null,
        tax_rate: row.tax_rate as number | string | null,
        tax_amount: row.tax_amount as number | string | null,
        discount_rate: row.discount_rate as number | string | null,
        discount_amount: row.discount_amount as number | string | null,
        total: row.total as number | string | null,
        payments_total: paymentsTotalById.get(row.id as string) ?? 0,
        currency: (row.currency as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        imported_from: (row.imported_from as string | null) ?? null,
        team_id: row.team_id as string,
        customer_id: (row.customer_id as string | null) ?? null,
        customer_name: customerName,
        customer_email: customerEmail,
      },
      teamNameById,
      today,
    );
    lines.push(
      INVOICE_CSV_HEADERS.map((h) => escapeCsvField(csvRow[h])).join(","),
    );
  }

  const csv = lines.join("\n") + "\n";
  const filename = `shyre-invoices-${today}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Today as a UTC YYYY-MM-DD. The previous server-local impl could
 *  silently shift dates depending on which Vercel region serves the
 *  request — UTC keeps the export stable across regions. */
function todayUtcDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
