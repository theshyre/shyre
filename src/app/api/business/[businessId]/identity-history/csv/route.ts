import { createClient } from "@/lib/supabase/server";
import { escapeCsvField } from "@/lib/time/csv";
import { logError } from "@/lib/logger";
import { getBusinessIdentityHistoryAction } from "@/app/(dashboard)/business/actions";
import {
  BUSINESS_FIELD_LABELS,
  REGISTRATION_FIELD_LABELS,
  IDENTITY_HISTORY_HIDDEN_KEYS,
  identityGroupKey,
  type IdentityHistoryEntry,
} from "@/app/(dashboard)/business/identity-history-types";
import { expandWithFieldDiffs } from "@/app/(dashboard)/business/[businessId]/people/history/history-format";
import { expandToCsvRows } from "@/app/(dashboard)/business/history-csv";

/**
 * GET /api/business/[businessId]/identity-history/csv
 *
 * Streams the merged businesses + state-registrations history as CSV.
 * One row per changed field per audit entry. RLS on the two history
 * tables already gates visibility (owner|admin only); this just
 * re-uses the action.
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

  // Pull a deliberately wide window — bookkeepers exporting want the
  // whole timeline, not a paginated window.
  let allEntries: IdentityHistoryEntry[] = [];
  let offset = 0;
  try {
    // Cap iterations so a runaway query can't loop forever; 50 pages
    // × 500 = 25k entries is more than any real business will have.
    for (let i = 0; i < 50; i++) {
      const { history, hasMore } = await getBusinessIdentityHistoryAction(
        businessId,
        { limit: 500, offset },
      );
      allEntries = [...allEntries, ...history];
      if (!hasMore) break;
      offset += history.length;
    }
  } catch (err) {
    logError(err, {
      userId: user.id,
      url: `/api/business/${businessId}/identity-history/csv`,
      action: "exportIdentityHistory",
    });
    return new Response("Export failed", { status: 500 });
  }

  const expanded = expandWithFieldDiffs({
    entries: allEntries,
    groupKey: identityGroupKey,
    previousState: (e: IdentityHistoryEntry) => e.previousState,
    labels: (e) =>
      e.kind === "business"
        ? BUSINESS_FIELD_LABELS
        : REGISTRATION_FIELD_LABELS,
    hiddenKeys: IDENTITY_HISTORY_HIDDEN_KEYS,
  });

  const out = expandToCsvRows(expanded, (entry) => ({
    changed_at: entry.changedAt,
    kind: entry.kind,
    row_label: entry.rowLabel,
    operation: entry.operation,
    actor_name: entry.changedBy.displayName ?? "",
    actor_user_id: entry.changedBy.userId ?? "",
  }));

  const headers = [
    "changed_at",
    "kind",
    "row_label",
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
        r.kind,
        r.row_label,
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
  const filename = `shyre-identity-history-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
