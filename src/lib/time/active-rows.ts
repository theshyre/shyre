import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wraps the `stint_active_rows` Postgres RPC.
 *
 * A timesheet "row" is a (project, category) slot the user logs time
 * against. Today's Week / Day views derive the visible row set
 * implicitly from the entries that exist on the visible week.
 * Persistent rows (persona-converged 2026-05-13) extend that with two
 * primitives:
 *
 *   - per-user pins (`time_pinned_rows`)
 *   - team defaults (`time_team_default_rows`)
 *
 * The RPC unions:
 *   1. Distinct (project, category) from entries in [since, now] for
 *      this user.
 *   2. The user's pinned rows.
 *   3. The team's default rows.
 *
 * and filters out projects the user can't see (RLS) or that are
 * archived. The `source` column tells the UI which bucket(s) a row
 * came from, so it can render a pin badge / team-default chip and
 * decide whether to offer pin/unpin affordances.
 *
 * Returns minimal data — the caller resolves project / category
 * metadata against its already-fetched projects + categories lists.
 */

export type ActiveRowSource = "recent" | "pinned" | "team_default";

export interface ActiveRow {
  projectId: string;
  categoryId: string | null;
  /** Comma-joined subset of ActiveRowSource — e.g. "pinned,recent"
   *  when a row is both freshly pinned and has entries this week. */
  source: string;
  lastActivityAt: string;
}

/** Default sliding window for the "recent entries" half of the
 *  union. 14 days covers a typical solo consultant's slow week +
 *  recovery. Configurable via Settings → Time tracking in a follow-up
 *  per the 2026-05-13 persona reviews. */
export const DEFAULT_ACTIVE_WINDOW_DAYS = 14;

export async function getActiveRows(
  supabase: SupabaseClient,
  teamId: string,
  userId: string,
  sinceDate: Date = defaultSince(),
): Promise<ActiveRow[]> {
  const { data, error } = await supabase.rpc("stint_active_rows", {
    p_team_id: teamId,
    p_user_id: userId,
    p_since: sinceDate.toISOString(),
  });
  if (error) {
    // Don't throw on a soft fetch failure — the row set is an
    // augmentation, not a primary data path. Returning [] lets the
    // Week / Day views fall back to their entry-derived row set,
    // which is correct but missing the pinned/team-default
    // augmentation. The error is still worth logging upstream by
    // the caller if it has a logger in scope.
    return [];
  }
  if (!data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    projectId: r.project_id as string,
    categoryId: (r.category_id as string | null) ?? null,
    source: (r.source as string) ?? "recent",
    lastActivityAt: (r.last_activity_at as string) ?? new Date().toISOString(),
  }));
}

/** Helper for tests / call sites that want the canonical 14-day
 *  window without rolling their own Date math. */
export function defaultSince(now: Date = new Date()): Date {
  return new Date(
    now.getTime() - DEFAULT_ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

/** True when the given source string includes the named bucket. The
 *  RPC returns comma-joined sources (e.g. "pinned,recent") so a
 *  substring check would false-positive on prefixes; split + look
 *  up explicitly. */
export function isSource(source: string, kind: ActiveRowSource): boolean {
  return source.split(",").includes(kind);
}
