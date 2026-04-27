/**
 * Pure types + helpers for business_people_history. Lives outside
 * `people-actions.ts` because that file is `"use server"` and
 * `server-only` blows up in the test environment.
 */

export interface PersonHistoryEntry {
  id: string;
  operation: "UPDATE" | "DELETE";
  changedAt: string;
  changedBy: {
    userId: string | null;
    displayName: string | null;
    email: string | null;
  };
  previousState: Record<string, unknown>;
}

export interface BusinessPersonHistoryEntry extends PersonHistoryEntry {
  /** Person this entry is about. We resolve the live row to a current
   *  display name where possible; if the person has been hard-deleted
   *  (rare today; soft delete is the path) we fall back to the
   *  legal_name captured in `previousState`. */
  personId: string;
  personDisplayName: string;
}

/** Raw `business_people_history` row (the columns the action reads). */
export interface RawBusinessPeopleHistoryRow {
  id: string;
  business_person_id: string;
  operation: "UPDATE" | "DELETE";
  changed_at: string;
  changed_by_user_id: string | null;
  previous_state: Record<string, unknown> | null;
}

/** Build a `personId → display name` map from a bulk
 *  `business_people` SELECT. Prefers `preferred_name`, falls back to
 *  `legal_name`, and finally to "Unknown" so the map always returns a
 *  non-empty string (lets call-sites use it directly without
 *  fallback ladders). */
export function buildPersonNameMap(
  rows: Array<{
    id: string;
    legal_name: string | null;
    preferred_name: string | null;
  }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const preferred = r.preferred_name ?? null;
    const legal = r.legal_name ?? "";
    const display = preferred ?? legal ?? "Unknown";
    out.set(r.id, display || "Unknown");
  }
  return out;
}

/** Build a `userId → display_name | null` map from a bulk
 *  `user_profiles` SELECT. Null values mean "the profile exists but
 *  the user hasn't set a display_name" — distinct from "no row." */
export function buildActorNameMap(
  rows: Array<{ user_id: string; display_name: string | null }>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of rows) {
    out.set(r.user_id, r.display_name ?? null);
  }
  return out;
}

/** Pure mapper: convert raw `business_people_history` rows + bulk
 *  lookup maps into BusinessPersonHistoryEntry objects. Extracted
 *  from `getBusinessPeopleHistoryAction` so the row-shape logic is
 *  unit-testable without a live DB. */
export function resolveBusinessPeopleHistoryEntries(args: {
  rows: RawBusinessPeopleHistoryRow[];
  actorNameById: Map<string, string | null>;
  personNameById: Map<string, string>;
  fallbackPersonName?: string;
}): BusinessPersonHistoryEntry[] {
  const fallback = args.fallbackPersonName ?? "Unknown person";
  return args.rows.map((r) => {
    const actorId = r.changed_by_user_id;
    const personId = r.business_person_id;
    const previousState = r.previous_state ?? {};
    const personDisplayName =
      args.personNameById.get(personId) ??
      (typeof previousState.legal_name === "string"
        ? (previousState.legal_name as string)
        : fallback);
    return {
      id: r.id,
      personId,
      personDisplayName,
      operation: r.operation,
      changedAt: r.changed_at,
      changedBy: {
        userId: actorId,
        displayName: actorId ? (args.actorNameById.get(actorId) ?? null) : null,
        email: null,
      },
      previousState,
    };
  });
}
