"use client";

/**
 * Cross-surface signal for "the running timer may have changed".
 *
 * The sidebar <Timer> is the sole running-timer UI, but start/stop
 * happens from several surfaces (entry-row kebab, week-row Play/Stop,
 * the /time-entries start form). Each of those surfaces calls a server
 * action and then dispatches this event so the sidebar can re-fetch
 * its own view of the running entry.
 *
 * Without this, the sidebar stayed on stale local state and showed a
 * running timer seconds after it was stopped elsewhere.
 */
export const TIMER_CHANGED_EVENT = "shyre:timer:changed";

export function notifyTimerChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TIMER_CHANGED_EVENT));
  }
}
