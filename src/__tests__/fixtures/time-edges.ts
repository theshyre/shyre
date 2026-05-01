/**
 * Shared time-entry fixtures for date/timezone edge cases.
 *
 * Every time-related view (day, week, the upcoming Log) needs to handle
 * the same set of edges: DST transitions, year boundaries, leap-day,
 * cross-midnight entries, and clock-skewed running timers. Without a
 * shared fixture set, each test file rolls its own — and inevitably
 * disagrees on what "spring forward" means, so a regression in one view
 * silently passes in another.
 *
 * Phase 1 of the Unified Time view rollout (see
 * docs/reference/unified-time.md). Reused by day/week tests today and
 * by Log tests when phase 2 lands.
 *
 * Shape rules:
 * - `makeEntry()` is the single factory; tests should never hand-build
 *   `TimeEntry` rows.
 * - Times in fixture *names* are wall-clock in the named TZ; ISO strings
 *   in fixture values are UTC. The factory takes a UTC `Date` so tests
 *   are explicit about which side of the conversion they're testing.
 * - All fixtures share `team_id="t1"`, `user_id="u1"`, `project_id="p1"`
 *   defaults. Override per-test as needed.
 *
 * Failure modes these fixtures exist to prevent:
 * - Fall-back hour rendered twice or omitted.
 * - NYE entry orphaned in neither year-band (or counted in both).
 * - Spring-forward entry rendered at a wall-clock time that didn't exist.
 * - Leap-day handled as Feb 28 + 1 day.
 * - Running timer with future start_time crashing the duration display.
 * - Cross-midnight entry double-counted in per-band totals.
 */

import type { TimeEntry, AuthorInfo, ProjectInfo } from
  "@/app/(dashboard)/time-entries/types";

interface MakeEntryInput {
  id: string;
  /** UTC start time. */
  start: Date;
  /** UTC end time, or null for a running timer. */
  end?: Date | null;
  /** Override duration; otherwise computed from end - start. */
  durationMin?: number | null;
  teamId?: string;
  userId?: string;
  projectId?: string;
  description?: string | null;
  billable?: boolean;
  categoryId?: string | null;
  author?: AuthorInfo | null;
  project?: ProjectInfo | null;
}

const DEFAULT_AUTHOR: AuthorInfo = {
  user_id: "u1",
  display_name: "Test User",
  avatar_url: null,
};

/**
 * Single factory for fixture entries. Tests should call this rather than
 * hand-building TimeEntry rows so the shape stays in sync with the type.
 */
export function makeEntry(input: MakeEntryInput): TimeEntry {
  const start = input.start;
  const end = input.end === undefined ? new Date(start.getTime() + 60 * 60_000) : input.end;
  const durationMin =
    input.durationMin !== undefined
      ? input.durationMin
      : end === null
        ? null
        : Math.round((end.getTime() - start.getTime()) / 60_000);
  return {
    id: input.id,
    team_id: input.teamId ?? "t1",
    user_id: input.userId ?? "u1",
    project_id: input.projectId ?? "p1",
    description: input.description ?? `entry ${input.id}`,
    start_time: start.toISOString(),
    end_time: end === null ? null : end.toISOString(),
    duration_min: durationMin,
    billable: input.billable ?? true,
    github_issue: null,
    category_id: input.categoryId ?? null,
    linked_ticket_provider: null,
    linked_ticket_key: null,
    linked_ticket_url: null,
    linked_ticket_title: null,
    linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    projects: input.project ?? null,
    author: input.author ?? DEFAULT_AUTHOR,
  };
}

// ---------------------------------------------------------------------------
// Edge fixtures
// ---------------------------------------------------------------------------

/**
 * US/Eastern spring-forward 2026.
 *
 * 2026-03-08 02:00 EST advances to 03:00 EDT — wall clock 02:30 doesn't
 * exist locally. UTC equivalents bracket the gap: 06:30Z (would have been
 * 01:30 EST, exists) and 07:30Z (= 03:30 EDT, exists; 02:30 is impossible).
 *
 * Use to assert that a render rooted at "user's local 2026-03-08" doesn't
 * synthesize a 02:30 row, and that a UTC-stored 06:30Z entry shows under
 * 2026-03-08 not 2026-03-07.
 */
export const SPRING_FORWARD_UTC_BEFORE = new Date("2026-03-08T06:30:00.000Z"); // 01:30 EST
export const SPRING_FORWARD_UTC_AFTER = new Date("2026-03-08T07:30:00.000Z");  // 03:30 EDT

export const springForwardEntries = (): TimeEntry[] => [
  makeEntry({
    id: "spring-before",
    start: SPRING_FORWARD_UTC_BEFORE,
    end: new Date(SPRING_FORWARD_UTC_BEFORE.getTime() + 30 * 60_000),
    description: "Pre-DST 01:30 EST",
  }),
  makeEntry({
    id: "spring-after",
    start: SPRING_FORWARD_UTC_AFTER,
    end: new Date(SPRING_FORWARD_UTC_AFTER.getTime() + 30 * 60_000),
    description: "Post-DST 03:30 EDT",
  }),
];

/**
 * US/Eastern fall-back 2026.
 *
 * 2026-11-01 02:00 EDT falls back to 01:00 EST — wall clock 01:30 occurs
 * twice. UTC representation is unambiguous (05:30Z = 01:30 EDT first
 * occurrence, 06:30Z = 01:30 EST second occurrence).
 *
 * Use to assert that a date-banded view shows BOTH entries under
 * 2026-11-01 (not split across days, not deduplicated by wall-clock).
 */
export const FALL_BACK_UTC_FIRST = new Date("2026-11-01T05:30:00.000Z");  // 01:30 EDT
export const FALL_BACK_UTC_SECOND = new Date("2026-11-01T06:30:00.000Z"); // 01:30 EST

export const fallBackEntries = (): TimeEntry[] => [
  makeEntry({
    id: "fall-first",
    start: FALL_BACK_UTC_FIRST,
    end: new Date(FALL_BACK_UTC_FIRST.getTime() + 15 * 60_000),
    description: "Fall-back 01:30 EDT (first)",
  }),
  makeEntry({
    id: "fall-second",
    start: FALL_BACK_UTC_SECOND,
    end: new Date(FALL_BACK_UTC_SECOND.getTime() + 15 * 60_000),
    description: "Fall-back 01:30 EST (second)",
  }),
];

/**
 * New Year's Eve cross-year entry.
 *
 * 2025-12-31 23:45 → 2026-01-01 00:30 (UTC for simplicity; exact TZ is
 * incidental). Per the doc's "start-day attribution" rule, the full
 * 45 minutes is attributed to 2025-12-31's band; the 2026-01-01 band
 * shows a continuation pill contributing zero minutes.
 *
 * Use to assert: (a) entry doesn't disappear, (b) doesn't double-count,
 * (c) lands on the start-day side of any year-boundary marker.
 */
export const NYE_START_UTC = new Date("2025-12-31T23:45:00.000Z");
export const NYE_END_UTC = new Date("2026-01-01T00:30:00.000Z");

export const nyeEntry = (): TimeEntry =>
  makeEntry({
    id: "nye-cross",
    start: NYE_START_UTC,
    end: NYE_END_UTC,
    description: "NYE cross-year",
  });

/**
 * Leap-day entry: 2024-02-29.
 *
 * Use to assert: the date-jump validator accepts "2024-02-29" without
 * shifting to Mar 1, the band labelled 2024-02-29 contains this entry,
 * and any quarter/year boundary math doesn't off-by-one across leap-day.
 */
export const LEAP_DAY_UTC = new Date("2024-02-29T14:00:00.000Z");

export const leapDayEntry = (): TimeEntry =>
  makeEntry({
    id: "leap-day",
    start: LEAP_DAY_UTC,
    end: new Date(LEAP_DAY_UTC.getTime() + 90 * 60_000),
    description: "Leap-day work",
  });

/**
 * Cross-midnight (within-year) entry: 2026-04-15 23:30 → 2026-04-16 00:30.
 *
 * Per the start-day-attribution rule, the full 60 minutes counts toward
 * 2026-04-15. Use to assert the rule in band totals AND CSV export
 * (the round-trip parity test).
 */
export const CROSS_MIDNIGHT_START_UTC = new Date("2026-04-15T23:30:00.000Z");
export const CROSS_MIDNIGHT_END_UTC = new Date("2026-04-16T00:30:00.000Z");

export const crossMidnightEntry = (): TimeEntry =>
  makeEntry({
    id: "cross-midnight",
    start: CROSS_MIDNIGHT_START_UTC,
    end: CROSS_MIDNIGHT_END_UTC,
    description: "Late-night session",
  });

/**
 * Far-future running timer.
 *
 * `start_time` is well past now (clock skew on the client, or a deliberate
 * future-dated entry). `end_time` is null and `duration_min` is null —
 * this is what a running timer looks like.
 *
 * Use to assert the duration display tolerates negative wall-clock deltas
 * without crashing or rendering "-2h 14m" garbage.
 */
export const FAR_FUTURE_START_UTC = new Date("2099-01-01T12:00:00.000Z");

export const farFutureRunningTimer = (): TimeEntry =>
  makeEntry({
    id: "far-future-running",
    start: FAR_FUTURE_START_UTC,
    end: null,
    durationMin: null,
    description: "Clock-skewed running timer",
  });

/**
 * Convenience: every edge fixture in one array, useful for "render a busy
 * scroll log without crashing" smoke tests.
 */
export const allEdgeEntries = (): TimeEntry[] => [
  ...springForwardEntries(),
  ...fallBackEntries(),
  nyeEntry(),
  leapDayEntry(),
  crossMidnightEntry(),
  farFutureRunningTimer(),
];
