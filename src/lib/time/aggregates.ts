/**
 * Server-side time-entry aggregates.
 *
 * Single canonical query path consumed by:
 *   - Day / week band totals (the Log will use it; day/week views currently
 *     DOM-sum a fixed window, which is fine for now — they can adopt this
 *     helper when the band layout reuses it).
 *   - Filter-chip counts ("312 entries match").
 *   - The CSV export route's totals row (when it grows one — currently the
 *     export emits rows only; the bookkeeper-grade parity test asserts that
 *     this helper's total equals the sum of those rows over the same range).
 *
 * RLS-respecting: the helper accepts a Supabase client (the caller's
 * session client) and issues a regular `.from("time_entries").select()` —
 * NOT a SECURITY DEFINER RPC. SAL-006 lesson: aggregates that bypass RLS
 * are the unguarded flank. If a viewer can't see a row, that row's minutes
 * don't roll into their total.
 *
 * Cross-midnight attribution: per the doc decision (closed 2026-04-30),
 * each entry's full duration is attributed to the band of its `start_time`.
 * The display layer can render a continuation pill in the second band
 * with zero contribution to that band's total.
 *
 * Scale note: phase 1 sums in JS after the Supabase fetch. The 500-row
 * server cap and the team-scoped composite index make this fine at
 * current row counts. Promote to a Postgres aggregate (RPC or
 * `?select=duration_min.sum()`) if a real workload pushes it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AggregateGroupBy = "day" | "week" | "month";

export interface TimeEntriesAggregateInput {
  /** Single team to scope. Pass null only when caller intentionally wants
   *  every team they can read (RLS still narrows). */
  teamId: string | null;
  /** Range start, inclusive. UTC. */
  fromUtc: Date;
  /** Range end, exclusive. UTC. */
  toUtc: Date;
  groupBy: AggregateGroupBy;
  /** When non-null, narrow to these user_ids. */
  memberFilter: string[] | null;
  /** When true, only billable=true entries roll into total_min AND
   *  billable_min (entry_count still counts only billable). */
  billableOnly: boolean;
}

export interface TimeEntryAggregateRow {
  /** YYYY-MM-DD when groupBy='day'; YYYY-Www (ISO week) when 'week';
   *  YYYY-MM when 'month'. Bucket is computed in the user's TZ if you
   *  pre-shift inputs; this helper computes in UTC by default. */
  bucket: string;
  total_min: number;
  billable_min: number;
  entry_count: number;
}

interface RawRow {
  start_time: string;
  duration_min: number | null;
  billable: boolean;
}

/**
 * Compute per-bucket totals for time entries in the range, respecting
 * RLS via the caller's client. Returns rows ordered by bucket ascending;
 * empty buckets are NOT emitted (caller decides whether to render zero-days).
 */
export async function timeEntriesAggregate(
  supabase: SupabaseClient,
  input: TimeEntriesAggregateInput,
): Promise<TimeEntryAggregateRow[]> {
  // Empty member list = "no members selected" → no rows. Short-circuit
  // before issuing any DB query.
  if (input.memberFilter !== null && input.memberFilter.length === 0) {
    return [];
  }

  let q = supabase
    .from("time_entries")
    .select("start_time, duration_min, billable")
    .is("deleted_at", null)
    .gte("start_time", input.fromUtc.toISOString())
    .lt("start_time", input.toUtc.toISOString());

  if (input.teamId) q = q.eq("team_id", input.teamId);
  if (input.billableOnly) q = q.eq("billable", true);
  if (input.memberFilter !== null) {
    q = q.in("user_id", input.memberFilter);
  }

  const { data, error } = await q;
  if (error) throw error;
  return rollUp((data as RawRow[]) ?? [], input.groupBy);
}

/** Group + sum rows into buckets. Exported for direct testing of the rollup. */
export function rollUp(
  rows: readonly RawRow[],
  groupBy: AggregateGroupBy,
): TimeEntryAggregateRow[] {
  const byBucket = new Map<string, TimeEntryAggregateRow>();
  for (const row of rows) {
    const min = row.duration_min ?? 0;
    if (min <= 0) continue; // running timers don't contribute to totals
    const bucket = bucketKey(row.start_time, groupBy);
    const existing = byBucket.get(bucket);
    if (existing) {
      existing.total_min += min;
      existing.entry_count += 1;
      if (row.billable) existing.billable_min += min;
    } else {
      byBucket.set(bucket, {
        bucket,
        total_min: min,
        billable_min: row.billable ? min : 0,
        entry_count: 1,
      });
    }
  }
  return [...byBucket.values()].sort((a, b) =>
    a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0,
  );
}

function bucketKey(startIso: string, groupBy: AggregateGroupBy): string {
  const d = new Date(startIso);
  if (groupBy === "month") {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
  }
  if (groupBy === "week") {
    const { year, week } = isoWeekParts(d);
    return `${year}-W${pad2(week)}`;
  }
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * ISO 8601 week parts (Mon-starting). The ISO year can differ from the
 * calendar year for late-December dates (which can land in week 1 of the
 * next ISO year) and early-January dates (which can land in week 52 or 53
 * of the previous ISO year).
 */
function isoWeekParts(d: Date): { year: number; week: number } {
  // The ISO year is the year of the Thursday of the same ISO week.
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = target.getUTCDay() || 7; // 1..7, Mon..Sun
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const diffDays = (target.getTime() - yearStart.getTime()) / 86_400_000;
  const week = Math.ceil((diffDays + 1) / 7);
  return { year: isoYear, week };
}
