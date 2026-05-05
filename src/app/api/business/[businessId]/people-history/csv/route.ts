import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import { logError } from "@/lib/logger";
import {
  expandWithFieldDiffs,
  FIELD_LABELS,
  HIDDEN_KEYS,
} from "@/app/(dashboard)/business/[businessId]/people/history/history-format";
import { expandToCsvRows } from "@/app/(dashboard)/business/history-csv";

/**
 * GET /api/business/[businessId]/people-history/csv
 *
 * Streams the full audit timeline as CSV — one row per changed field
 * per UPDATE/DELETE entry. Used by the "Export CSV" button on
 * /business/[businessId]/people/history for compliance dumps.
 *
 * Authorization is gated by RLS on business_people_history (owner/
 * admin sees all, linked user sees their own). We don't paginate
 * here — bookkeepers exporting for an audit cycle want the whole
 * file, not a page of it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
): Promise<Response> {
  const { businessId } = await context.params;
  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const personId = url.searchParams.get("personId");
  const actorUserId = url.searchParams.get("actorUserId");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let query = supabase
    .from("business_people_history")
    .select(
      "id, business_person_id, operation, changed_at, changed_by_user_id, previous_state",
    )
    .eq("business_id", businessId);
  if (fromParam) query = query.gte("changed_at", fromParam);
  if (toParam) {
    const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(toParam);
    query = query.lte(
      "changed_at",
      isBareDate ? `${toParam}T23:59:59.999Z` : toParam,
    );
  }
  if (personId) query = query.eq("business_person_id", personId);
  if (actorUserId) query = query.eq("changed_by_user_id", actorUserId);
  const { data: rows, error } = await query.order("changed_at", {
    ascending: false,
  });
  if (error) {
    logError(error, {
      userId: user.id,
      url: `/api/business/${businessId}/people-history/csv`,
      action: "exportPeopleHistory",
    });
    return new Response("Export failed", { status: 500 });
  }

  type Row = NonNullable<typeof rows>[number];
  const allRows: Row[] = rows ?? [];

  // Bulk lookups — actors + live person names (so deleted people
  // still get a label via the legal_name in their last snapshot).
  const actorIds = Array.from(
    new Set(
      allRows
        .map((r) => r.changed_by_user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const personIds = Array.from(
    new Set(allRows.map((r) => r.business_person_id as string)),
  );

  const [profilesRes, peopleRes] = await Promise.all([
    actorIds.length > 0
      ? supabase
          .from("user_profiles")
          .select("user_id, display_name")
          .in("user_id", actorIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string | null }[] }),
    personIds.length > 0
      ? supabase
          .from("business_people")
          .select("id, legal_name, preferred_name")
          .in("id", personIds)
      : Promise.resolve({ data: [] as { id: string; legal_name: string | null; preferred_name: string | null }[] }),
  ]);

  const actorNameById = new Map<string, string | null>();
  for (const p of profilesRes.data ?? []) {
    actorNameById.set(
      p.user_id,
      p.display_name,
    );
  }
  const personNameById = new Map<string, string>();
  for (const p of peopleRes.data ?? []) {
    personNameById.set(p.id, p.preferred_name ?? p.legal_name ?? "");
  }

  const expanded = expandWithFieldDiffs({
    entries: allRows,
    groupKey: (r) => r.business_person_id as string,
    previousState: (r) =>
      (r.previous_state as Record<string, unknown> | null) ?? {},
    labels: () => FIELD_LABELS,
    hiddenKeys: HIDDEN_KEYS,
  });

  const out = expandToCsvRows(expanded, (row) => {
    const personId = row.business_person_id as string;
    const prev = (row.previous_state as Record<string, unknown> | null) ?? {};
    const personName =
      personNameById.get(personId) ||
      (typeof prev.legal_name === "string" ? (prev.legal_name as string) : "Unknown");
    const actorId = (row.changed_by_user_id as string | null) ?? "";
    const actorName = actorId ? (actorNameById.get(actorId) ?? "") : "";
    return {
      changed_at: row.changed_at as string,
      person_name: personName,
      person_id: personId,
      operation: row.operation as string,
      actor_name: actorName ?? "",
      actor_user_id: actorId,
    };
  });

  const headers = [
    "changed_at",
    "person_name",
    "person_id",
    "operation",
    "actor_name",
    "actor_user_id",
    "field",
    "previous_value",
    "new_value",
  ];
  const lines: string[] = [headers.join(",")];
  for (const r of out) {
    lines.push(
      [
        r.changed_at,
        r.person_name,
        r.person_id,
        r.operation,
        r.actor_name,
        r.actor_user_id,
        r.field,
        r.previous_value,
        r.new_value,
      ]
        .map((v) => escapeCsvField(v))
        .join(","),
    );
  }
  const csv = lines.join("\n") + "\n";

  const today = new Date();
  const stamp = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  const filename = `shyre-people-history-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
