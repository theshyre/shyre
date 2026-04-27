import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import {
  computeFieldDiff,
  formatValue,
} from "@/app/(dashboard)/business/[businessId]/people/history/history-format";

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
  _request: Request,
  context: { params: Promise<{ businessId: string }> },
): Promise<Response> {
  const { businessId } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("business_people_history")
    .select(
      "id, business_person_id, operation, changed_at, changed_by_user_id, previous_state",
    )
    .eq("business_id", businessId)
    .order("changed_at", { ascending: false });
  if (error) {
    return new Response(`Export failed: ${error.message}`, { status: 500 });
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

  // Diff each entry against the next-newer entry for the same person
  // (entries arrive interleaved; group by person to find each
  // entry's neighbor in time).
  const newerByPerson = new Map<string, Row>();
  type CsvRow = {
    changed_at: string;
    person_name: string;
    person_id: string;
    operation: string;
    actor_name: string;
    actor_user_id: string;
    field: string;
    previous_value: string;
    new_value: string;
  };
  const out: CsvRow[] = [];

  // Walk oldest → newest so the "newer" neighbor is known when we
  // reach each row. Append in oldest-first order, then reverse at
  // the end so the CSV reads newest-first to match the page.
  const oldestFirst = [...allRows].reverse();
  for (const row of oldestFirst) {
    const personId = row.business_person_id as string;
    const newer = newerByPerson.get(personId);
    const prev = (row.previous_state as Record<string, unknown> | null) ?? {};
    const diff = computeFieldDiff(
      prev,
      newer ? ((newer.previous_state as Record<string, unknown> | null) ?? null) : null,
    );

    const personName =
      personNameById.get(personId) ||
      (typeof prev.legal_name === "string" ? (prev.legal_name as string) : "Unknown");
    const actorId = (row.changed_by_user_id as string | null) ?? "";
    const actorName = actorId ? (actorNameById.get(actorId) ?? "") : "";

    if (diff.length === 0) {
      // Edit recorded but no labeled fields changed — keep a
      // placeholder row so the export reflects every audit entry.
      out.push({
        changed_at: row.changed_at as string,
        person_name: personName,
        person_id: personId,
        operation: row.operation as string,
        actor_name: actorName ?? "",
        actor_user_id: actorId,
        field: "",
        previous_value: "",
        new_value: "",
      });
    } else {
      for (const field of diff) {
        out.push({
          changed_at: row.changed_at as string,
          person_name: personName,
          person_id: personId,
          operation: row.operation as string,
          actor_name: actorName ?? "",
          actor_user_id: actorId,
          field: field.label,
          previous_value: formatValue(field.from),
          new_value:
            field.to === undefined ? "" : formatValue(field.to),
        });
      }
    }

    newerByPerson.set(personId, row);
  }

  out.reverse();

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
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
