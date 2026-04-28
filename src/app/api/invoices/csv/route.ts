import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import {
  buildInvoiceCsvRow,
  INVOICE_CSV_HEADERS,
} from "@/app/(dashboard)/invoices/invoice-csv";

/**
 * GET /api/invoices/csv
 *
 * Streams the invoice list as CSV — one row per invoice, columns
 * mirror the visible table plus subtotal / tax / total / due_date /
 * notes for accountant handoff. Honors the same filters as the
 * page (`org`, `status`, `customerId`, `from`, `to`).
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
      "invoice_number, status, issued_date, due_date, subtotal, tax_rate, tax_amount, total, currency, notes, imported_from, customers(name), team_id",
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
    return new Response(`Export failed: ${error.message}`, { status: 500 });
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

  const today = todayLocalDate();

  const lines: string[] = [INVOICE_CSV_HEADERS.join(",")];

  for (const row of rows ?? []) {
    const customerName =
      row.customers &&
      typeof row.customers === "object" &&
      "name" in row.customers
        ? ((row.customers as { name: string }).name ?? "")
        : "";
    const csvRow = buildInvoiceCsvRow(
      {
        invoice_number: row.invoice_number as string,
        status: (row.status as string | null) ?? null,
        issued_date: (row.issued_date as string | null) ?? null,
        due_date: (row.due_date as string | null) ?? null,
        subtotal: row.subtotal as number | string | null,
        tax_rate: row.tax_rate as number | string | null,
        tax_amount: row.tax_amount as number | string | null,
        total: row.total as number | string | null,
        currency: (row.currency as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        imported_from: (row.imported_from as string | null) ?? null,
        team_id: row.team_id as string,
        customer_name: customerName,
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

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
