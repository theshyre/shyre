import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import { logError } from "@/lib/logger";

/**
 * GET /api/business/[businessId]/expenses/csv
 *
 * Streams expenses for a single business as CSV. Honors the same
 * filters as the page: `from`, `to`, `team`, `category`, `billable`,
 * and a soft-delete toggle (`includeDeleted=1`). Each row carries
 * the reconciliation columns bookkeepers need to tie back to the
 * source record (expense_id, team_id, project_id) plus money,
 * category, vendor, and the imported_from marker so QuickBooks /
 * Xero reconciliation can flag Harvest-imported rows.
 *
 * Authorization: RLS already gates expense visibility per business
 * via team-scoped policies. We additionally `eq("business_id")` so
 * a businessId mismatch with the URL silently filters out rather
 * than over-fetching across businesses the caller might also touch.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
): Promise<Response> {
  const { businessId } = await context.params;
  const url = new URL(request.url);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const teamId = url.searchParams.get("team");
  const category = url.searchParams.get("category");
  const billable = url.searchParams.get("billable");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const includeDeleted = url.searchParams.get("includeDeleted") === "1";

  // Resolve teams under the business — RLS still gates access — so
  // the export is scoped to teams the caller can read AND that
  // belong to this business.
  const { data: businessTeams, error: teamsErr } = await supabase
    .from("teams")
    .select("id")
    .eq("business_id", businessId);
  if (teamsErr) {
    logError(teamsErr, {
      userId: user.id,
      url: `/api/business/${businessId}/expenses/csv`,
      action: "exportExpenses.teams",
    });
    return new Response("Export failed", { status: 500 });
  }
  const teamIds = (businessTeams ?? []).map((t) => t.id as string);
  if (teamIds.length === 0) {
    // No accessible teams under this business — return an empty CSV
    // with headers so spreadsheets don't choke.
    return emptyCsv(businessId);
  }

  let query = supabase
    .from("expenses")
    .select(
      "id, team_id, user_id, incurred_on, amount, currency, vendor, category, description, notes, project_id, billable, imported_from, imported_at, created_at, deleted_at, projects(name, customer_id, customers(name))",
    )
    .in("team_id", teamIds)
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (!includeDeleted) query = query.is("deleted_at", null);
  if (teamId) query = query.eq("team_id", teamId);
  if (category) query = query.eq("category", category);
  if (billable === "1") query = query.eq("billable", true);
  if (billable === "0") query = query.eq("billable", false);
  if (fromParam) query = query.gte("incurred_on", fromParam);
  if (toParam) query = query.lte("incurred_on", toParam);

  const { data: rows, error } = await query;
  if (error) {
    logError(error, {
      userId: user.id,
      teamId: teamId ?? undefined,
      url: `/api/business/${businessId}/expenses/csv`,
      action: "exportExpenses",
    });
    return new Response("Export failed", { status: 500 });
  }

  const teamNameById = await loadTeamNames(supabase, teamIds);

  const HEADERS = [
    "expense_id",
    "incurred_on",
    "team",
    "team_id",
    "vendor",
    "amount",
    "currency",
    "category",
    "billable",
    "project",
    "project_id",
    "customer",
    "customer_id",
    "description",
    "notes",
    "imported_from",
    "imported_at",
    "created_at",
    "deleted_at",
    "user_id",
    "business_id",
  ];

  const lines: string[] = [HEADERS.join(",")];
  for (const row of rows ?? []) {
    const project = unwrapOne<{
      name: string;
      customer_id: string | null;
      customers: unknown;
    }>(row.projects);
    const customer = project ? unwrapOne<{ name: string }>(project.customers) : null;
    lines.push(
      [
        row.id as string,
        (row.incurred_on as string | null) ?? "",
        teamNameById.get(row.team_id as string) ?? "",
        row.team_id as string,
        (row.vendor as string | null) ?? "",
        row.amount !== null && row.amount !== undefined
          ? String(row.amount)
          : "",
        ((row.currency as string | null) ?? "USD").toUpperCase(),
        (row.category as string | null) ?? "",
        row.billable === true,
        project?.name ?? "",
        (row.project_id as string | null) ?? "",
        customer?.name ?? "",
        (project?.customer_id as string | null) ?? "",
        (row.description as string | null) ?? "",
        (row.notes as string | null) ?? "",
        (row.imported_from as string | null) ?? "",
        (row.imported_at as string | null) ?? "",
        (row.created_at as string | null) ?? "",
        (row.deleted_at as string | null) ?? "",
        row.user_id as string,
        businessId,
      ]
        .map((v) => escapeCsvField(v))
        .join(","),
    );
  }
  const csv = lines.join("\n") + "\n";
  const stamp = todayUtcDate();
  const filename = `shyre-expenses-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function loadTeamNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (teamIds.length === 0) return out;
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .in("id", teamIds);
  for (const t of teams ?? []) {
    out.set(t.id as string, (t.name as string) ?? "");
  }
  return out;
}

function emptyCsv(businessId: string): Response {
  const stamp = todayUtcDate();
  const csv = "expense_id\n";
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shyre-expenses-${businessId}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function todayUtcDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}
