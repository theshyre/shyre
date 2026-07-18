/**
 * Agent-vs-human wall-clock overlap detection for the invoice builder
 * (SAL-051 P3 — the invoice flow IS the review step for agent-tracked
 * time; see docs/reference/multi-stream-timers.md).
 *
 * Pure, client-side computation over the candidate entries the
 * builder already loaded. Detection only — no data mutation, no
 * auto-merge, no blocking. The UI renders a warning badge on the
 * agent-started entry and offers a one-click "Exclude" that removes
 * it from the invoice selection; the underlying rows are untouched.
 *
 * An agent entry conflicts with a human entry when ALL hold:
 *   - same author (`userId`) — an agent working while a DIFFERENT
 *     teammate tracks time is normal parallel work, not double-billing;
 *   - same project (`projectId`) — cross-project concurrency is the
 *     whole point of agent attribution, never a warning;
 *   - wall-clock ranges genuinely intersect:
 *     `start < other.end AND end > other.start`, compared via
 *     `Date.getTime()` — NEVER string comparison (Postgres emits
 *     `+00:00`, JS emits `Z`; see feedback_timestamp_comparison).
 *     Strict inequalities mean touching ranges (one ends exactly
 *     when the other starts) do NOT overlap.
 *
 * Entries missing either bound (open-ended running timers) are
 * skipped: they can't be invoice candidates (the builder query
 * requires `end_time IS NOT NULL`), and warning on a still-running
 * timer would be noise. Kinds other than 'agent' and 'user'
 * ('integration', 'import') never participate on either side —
 * same-kind pairs are ignored by construction.
 */

export interface OverlapEntry {
  id: string;
  /** Author of the entry — agent entries carry the user the token
   *  acts on behalf of, so same-user comparison is meaningful. */
  userId: string;
  projectId: string;
  /** `time_entries.started_by_kind` — 'user' | 'agent' |
   *  'integration' | 'import'. Only 'agent' vs 'user' pairs are
   *  compared. */
  startedByKind: string;
  /** ISO timestamps (timestamptz). Null = open-ended / unknown. */
  startTime: string | null;
  endTime: string | null;
  /** Display label used to NAME the conflicting entry in the
   *  warning tooltip. Null when the entry has no description. */
  description: string | null;
}

export interface AgentOverlapConflict {
  /** The agent-started entry that gets the warning badge. */
  agentEntryId: string;
  /** The human entry it collides with (earliest-starting one when
   *  several collide). */
  conflictingEntryId: string;
  conflictingDescription: string | null;
  /** YYYY-MM-DD of the conflicting entry's start — tooltip fallback
   *  when the human entry has no description. */
  conflictingDate: string;
}

interface ParsedEntry {
  entry: OverlapEntry;
  startMs: number;
  endMs: number;
}

function parseBounds(entry: OverlapEntry): ParsedEntry | null {
  if (!entry.startTime || !entry.endTime) return null;
  const startMs = new Date(entry.startTime).getTime();
  const endMs = new Date(entry.endTime).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  // Inverted range (end before start) is corrupt data — e.g. a bad
  // import. Without this guard the intersection formula can still
  // fire on it (both bounds inside the other range), producing a
  // warning anchored to garbage. Skip; zero-length ranges are kept.
  if (endMs < startMs) return null;
  return { entry, startMs, endMs };
}

/**
 * Detect overlaps between agent-started and human entries among the
 * invoice-candidate set. Returns a map keyed by the AGENT entry's id;
 * agent entries without conflicts are absent. When an agent entry
 * overlaps several human entries, the earliest-starting human entry
 * is reported (deterministic, and the most likely "you were already
 * working" anchor).
 */
export function detectAgentOverlaps(
  entries: readonly OverlapEntry[],
): Map<string, AgentOverlapConflict> {
  // Bucket by author+project so comparisons never cross those axes.
  const humanByScope = new Map<string, ParsedEntry[]>();
  const agents: ParsedEntry[] = [];
  for (const entry of entries) {
    if (entry.startedByKind !== "agent" && entry.startedByKind !== "user") {
      continue;
    }
    const parsed = parseBounds(entry);
    if (!parsed) continue;
    if (entry.startedByKind === "agent") {
      agents.push(parsed);
    } else {
      const key = `${entry.userId}::${entry.projectId}`;
      const bucket = humanByScope.get(key);
      if (bucket) {
        bucket.push(parsed);
      } else {
        humanByScope.set(key, [parsed]);
      }
    }
  }

  const conflicts = new Map<string, AgentOverlapConflict>();
  for (const agent of agents) {
    const key = `${agent.entry.userId}::${agent.entry.projectId}`;
    const humans = humanByScope.get(key);
    if (!humans) continue;
    let best: ParsedEntry | null = null;
    for (const human of humans) {
      // Strict comparison: touching ranges do not overlap.
      if (agent.startMs < human.endMs && agent.endMs > human.startMs) {
        if (!best || human.startMs < best.startMs) best = human;
      }
    }
    if (best) {
      conflicts.set(agent.entry.id, {
        agentEntryId: agent.entry.id,
        conflictingEntryId: best.entry.id,
        conflictingDescription: best.entry.description,
        conflictingDate: new Date(best.startMs).toISOString().slice(0, 10),
      });
    }
  }
  return conflicts;
}

/**
 * Sum of `durationMin` across agent-started entries. Drives the
 * "Agent hours" subtotal in the builder's totals rail (rendered only
 * when > 0).
 */
export function sumAgentMinutes(
  entries: ReadonlyArray<{ startedByKind: string; durationMin: number }>,
): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.startedByKind === "agent") total += entry.durationMin;
  }
  return total;
}
