import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import { logError } from "@/lib/logger";

/**
 * GET /api/customers/csv
 *
 * Streams every customer the caller can see as CSV — id, team, name,
 * email, address, default_rate, archived flag, and timestamps. Honors
 * the `org` filter from the customers list page so an export
 * matches what's on screen.
 *
 * Authorization is gated by RLS — the session user's Supabase client
 * is used. RLS already filters by team / sharing visibility, so the
 * export is exactly the rows the caller could see in `/customers`.
 *
 * Bookkeeper persona requirement: an exported row must be tie-able
 * back to a database record (`id`, `team_id`). Solo persona
 * requirement: every entity has *some* CSV path so the data is not
 * held hostage.
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
  const includeArchived =
    url.searchParams.get("includeArchived") === "1";

  let query = supabase
    .from("customers")
    .select(
      "id, team_id, name, email, address, notes, default_rate, payment_terms_days, archived, imported_from, imported_at, created_at",
    )
    .order("name", { ascending: true });

  if (teamId) query = query.eq("team_id", teamId);
  if (!includeArchived) query = query.eq("archived", false);

  const { data: rows, error } = await query;
  if (error) {
    logError(error, {
      userId: user.id,
      teamId: teamId ?? undefined,
      url: "/api/customers/csv",
      action: "exportCustomers",
    });
    return new Response("Export failed", { status: 500 });
  }

  // Resolve team names so the CSV's `team` column shows a label not
  // a UUID.
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

  const HEADERS = [
    "customer_id",
    "team",
    "team_id",
    "name",
    "email",
    "address",
    "notes",
    "default_rate",
    "payment_terms_days",
    "archived",
    "imported_from",
    "imported_at",
    "created_at",
  ];

  const lines: string[] = [HEADERS.join(",")];
  for (const row of rows ?? []) {
    lines.push(
      [
        row.id as string,
        teamNameById.get(row.team_id as string) ?? "",
        row.team_id as string,
        (row.name as string | null) ?? "",
        (row.email as string | null) ?? "",
        (row.address as string | null) ?? "",
        (row.notes as string | null) ?? "",
        row.default_rate !== null && row.default_rate !== undefined
          ? String(row.default_rate)
          : "",
        row.payment_terms_days !== null && row.payment_terms_days !== undefined
          ? String(row.payment_terms_days)
          : "",
        row.archived === true,
        (row.imported_from as string | null) ?? "",
        (row.imported_at as string | null) ?? "",
        (row.created_at as string | null) ?? "",
      ]
        .map((v) => escapeCsvField(v))
        .join(","),
    );
  }
  const csv = lines.join("\n") + "\n";
  const stamp = todayUtcDate();
  const filename = `shyre-customers-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function todayUtcDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
