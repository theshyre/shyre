/**
 * "Last agent entry received" heartbeat status for the integrations page.
 *
 * The Recent API activity log only shows requests that REACHED the server —
 * but the most common Claude-tracking failures (no `jq`, `SHYRE_API_KEY` not
 * in Claude's env, repo not in the map) never make a request, so they never
 * appear there. This heartbeat looks at the opposite signal: when did an agent
 * entry actually LAND? A long silence is the absence-detector a consultant
 * needs ("no agent entries in 8 days — something's broken") that a success-only
 * activity log can't provide.
 *
 * Pure + nowMs-injected so it's deterministic to test.
 */

export type HeartbeatTone = "info" | "success" | "warning";
export type HeartbeatState = "none" | "active" | "stale";
export type HeartbeatUnit = "minutes" | "hours" | "days";

export interface HeartbeatStatus {
  state: HeartbeatState;
  tone: HeartbeatTone;
  /** Relative-age descriptor for the "X ago" string; null when state is "none". */
  unit: HeartbeatUnit | null;
  value: number;
}

/** Entries older than this read as "tracking may have stopped". */
export const HEARTBEAT_STALE_HOURS = 72;

export function agentHeartbeat(
  lastEntryIso: string | null,
  nowMs: number,
): HeartbeatStatus {
  if (!lastEntryIso) {
    return { state: "none", tone: "info", unit: null, value: 0 };
  }
  const then = new Date(lastEntryIso).getTime();
  if (Number.isNaN(then)) {
    return { state: "none", tone: "info", unit: null, value: 0 };
  }
  const diffMs = Math.max(0, nowMs - then);
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);

  const stale = hours >= HEARTBEAT_STALE_HOURS;
  const unit: HeartbeatUnit = hours < 1 ? "minutes" : hours < 24 ? "hours" : "days";
  const value = unit === "minutes" ? minutes : unit === "hours" ? hours : days;

  return {
    state: stale ? "stale" : "active",
    tone: stale ? "warning" : "success",
    unit,
    value,
  };
}
