/**
 * Pure grouping helper for the admin error dashboard.
 *
 * Identical errors — same error_code + message + action + url — collapse
 * into one group so the page shows "×N" instead of N near-identical
 * cards. Grouping happens in TS after the (already paginated, admin-only)
 * fetch; the DB query stays a plain ordered SELECT.
 */

export interface ErrorLogRow {
  id: string;
  error_code: string;
  severity: string;
  message: string;
  action: string | null;
  user_id: string | null;
  team_id: string | null;
  url: string | null;
  details: Record<string, unknown> | null;
  stack_trace: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ErrorOccurrence {
  id: string;
  created_at: string;
  resolved_at: string | null;
}

export interface ErrorGroup {
  /** Composite identity: error_code + message + action + url. */
  key: string;
  /** The newest occurrence — the group's representative row. */
  newest: ErrorLogRow;
  count: number;
  /** created_at of the oldest occurrence. */
  firstSeen: string;
  /** created_at of the newest occurrence. */
  lastSeen: string;
  /** Newest non-null stack trace across the group (the newest
   *  occurrence may have been logged without one). */
  stackTrace: string | null;
  /** Newest non-empty details bag across the group. */
  details: Record<string, unknown> | null;
  /** Ids still awaiting resolution — what "Mark resolved" targets. */
  unresolvedIds: string[];
  allResolved: boolean;
  /** All occurrences, newest first. */
  occurrences: ErrorOccurrence[];
}

/** NUL separator - cannot appear in the joined text fields. */
const KEY_SEP = "\u0000";

export function groupKeyFor(row: ErrorLogRow): string {
  return [row.error_code, row.message, row.action ?? "", row.url ?? ""].join(
    KEY_SEP,
  );
}

/**
 * Collapse rows into groups. Never string-compare timestamps —
 * Postgres emits `+00:00`, JS emits `Z` — so ordering uses epoch ms.
 * Groups come back ordered by lastSeen desc (newest activity first);
 * occurrences inside a group are newest-first.
 */
export function groupErrorRows(rows: ErrorLogRow[]): ErrorGroup[] {
  const byKey = new Map<string, ErrorLogRow[]>();
  for (const row of rows) {
    const key = groupKeyFor(row);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      byKey.set(key, [row]);
    }
  }

  const groups: ErrorGroup[] = [];
  for (const [key, bucket] of byKey) {
    const sorted = [...bucket].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const newest = sorted[0];
    const oldest = sorted[sorted.length - 1];
    if (!newest || !oldest) continue; // buckets are never empty; satisfies noUncheckedIndexedAccess
    const stackTrace =
      sorted.find((r) => r.stack_trace !== null)?.stack_trace ?? null;
    const details =
      sorted.find((r) => r.details && Object.keys(r.details).length > 0)
        ?.details ?? null;
    const unresolvedIds = sorted
      .filter((r) => r.resolved_at === null)
      .map((r) => r.id);

    groups.push({
      key,
      newest,
      count: sorted.length,
      firstSeen: oldest.created_at,
      lastSeen: newest.created_at,
      stackTrace,
      details,
      unresolvedIds,
      allResolved: unresolvedIds.length === 0,
      occurrences: sorted.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
      })),
    });
  }

  return groups.sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
  );
}
