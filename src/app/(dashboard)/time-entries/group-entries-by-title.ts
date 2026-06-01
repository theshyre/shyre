/**
 * Title-level aggregation for the weekly timesheet.
 *
 * A parent `Row` is keyed on (project, category, user), so its
 * `entriesByDay` is already single-author / single-project / single-
 * category. This collapses that matrix one level further: entries that
 * share a *title* fold onto one line whose durations spread across the
 * 7 day columns — turning a wall of one-row-per-entry sub-rows into a
 * scannable "task x day" grid (the user-requested "same title on one
 * line" view).
 *
 * Design decisions (settled via persona review, 2026-05-31):
 *
 *   - **Merge key = ticket key + trimmed description + billable flag.**
 *     Only *visually identical* lines merge, so the single rendered line
 *     never lies about its members. The billable flag is part of the key
 *     so a billable entry and a written-off (non-billable) entry on the
 *     same ticket never share a line — the bookkeeper lens requires the
 *     billable boundary stay visible. Description is trimmed (whitespace-
 *     only differences merge) but case-sensitive (a deliberate, tested
 *     choice — "Fix" and "fix" stay separate).
 *
 *   - **Invoiced state is NOT part of the key.** A title worked across a
 *     week can have some days invoiced and some not; those stay on one
 *     line, and the line carries an `invoicedState` of none/partial/all
 *     so the mixed case is signalled rather than split. Per-day lock is
 *     surfaced via `invoicedByDay`.
 *
 *   - **Display fold, never a data fold.** Every underlying entry is kept
 *     in `entriesByDay` so the UI can route a single-entry cell edit to
 *     that exact entry, expand an ambiguous (`hasCollision`) cell to its
 *     entries, and keep per-entry delete / play / history reachable. The
 *     CSV/PDF export continues to iterate `time_entries`, never this
 *     view model — a `TitleLine` has no entry id.
 *
 * Single author by construction: the parent row key already includes
 * `user_id`, and the week view only renders sub-rows for the viewer's
 * own rows, so a merged line is always one author — the time-entry
 * authorship rule is satisfied by rendering that author once.
 *
 * Pure + deterministic (sorted by earliest start_time, tie-broken by id)
 * so React re-renders never reshuffle the lines. Extracted as a
 * standalone function so the Day view can adopt the same collapse later
 * without a rewrite (Week-only for now — see week-timesheet.tsx).
 */

import type { TimeEntry } from "./types";

const DAYS_IN_WEEK = 7;

/** Collision-free merge key for a (ticketKey, trimmed description,
 *  billable) tuple. JSON-encoding escapes the strings, so no in-text
 *  character (spaces, separators) can make two different tuples share a
 *  key — `["A","B C",true]` and `["A B","C",true]` stay distinct. */
function titleKey(
  ticketKey: string | null,
  description: string,
  billable: boolean,
): string {
  return JSON.stringify([ticketKey ?? "", description, billable]);
}

/** How much of a merged line is already invoiced. Drives the line-level
 *  lock indicator: `partial` is its own state (>=2-channel glyph + word)
 *  because a single "fully billed" lock over partly-billed minutes would
 *  mislead a bookkeeper. */
export type InvoicedState = "none" | "partial" | "all";

export interface TitleLine {
  /** Stable grouping key — React key + dedup. Composed from
   *  ticket key + trimmed description + billable flag. */
  key: string;
  /** Identity fields, taken from the line's representative entry. They
   *  are homogeneous across members for ticketKey/description/billable
   *  by construction; the ticket url/provider derive from the key. */
  ticketKey: string | null;
  ticketUrl: string | null;
  ticketProvider: "jira" | "github" | null;
  description: string | null;
  billable: boolean;
  /** Per-day duration in minutes, length 7 (Mon..Sun) — committed
   *  minutes only; the UI adds live-elapsed for a running entry. */
  byDay: number[];
  /** Per-day "any entry on this day is invoiced" flag, length 7. */
  invoicedByDay: boolean[];
  /** Per-day first invoice id (for the lock chip link), length 7. */
  invoiceIdByDay: (string | null)[];
  /** Per-day underlying entries, length 7 — kept so a single-entry cell
   *  edits that exact entry and the disclosure can list them. */
  entriesByDay: TimeEntry[][];
  /** Total underlying entries across all days. */
  entryCount: number;
  /** Sum of `byDay` (committed minutes). */
  totalMin: number;
  /** How many of the entries are invoiced — drives `invoicedState`. */
  invoicedCount: number;
  invoicedState: InvoicedState;
  /** True when any entry on the line is currently running. */
  hasRunning: boolean;
  /** True when any single day holds >1 entry for this title — the
   *  ambiguous-cell case. Such a cell renders read-only (its sum has no
   *  single edit target) and the line auto-opens its entry disclosure. */
  hasCollision: boolean;
}

/**
 * Group a parent row's `entriesByDay` (length-7 matrix, single author /
 * project / category) into one `TitleLine` per distinct title. Entries
 * with a day index outside 0..6 are ignored defensively — the contract
 * is a length-7 matrix.
 */
export function groupEntriesByTitle(
  entriesByDay: TimeEntry[][],
): TitleLine[] {
  // Flatten to (entry, dayIndex) and sort deterministically so the
  // representative identity fields and the final line order are stable
  // across renders (start_time, then id as the tie-breaker).
  const flat: Array<{ entry: TimeEntry; dayIndex: number }> = [];
  for (let d = 0; d < entriesByDay.length; d += 1) {
    for (const entry of entriesByDay[d] ?? []) {
      flat.push({ entry, dayIndex: d });
    }
  }
  flat.sort((a, b) => {
    const byStart = a.entry.start_time.localeCompare(b.entry.start_time);
    return byStart !== 0 ? byStart : a.entry.id.localeCompare(b.entry.id);
  });

  const byKey = new Map<string, TitleLine>();
  for (const { entry, dayIndex } of flat) {
    if (dayIndex < 0 || dayIndex >= DAYS_IN_WEEK) continue;
    const desc = (entry.description ?? "").trim();
    const key = titleKey(entry.linked_ticket_key, desc, entry.billable);

    let line = byKey.get(key);
    if (!line) {
      line = {
        key,
        ticketKey: entry.linked_ticket_key,
        ticketUrl: entry.linked_ticket_url,
        ticketProvider: entry.linked_ticket_provider,
        description: entry.description,
        billable: entry.billable,
        byDay: [0, 0, 0, 0, 0, 0, 0],
        invoicedByDay: [false, false, false, false, false, false, false],
        invoiceIdByDay: [null, null, null, null, null, null, null],
        entriesByDay: [[], [], [], [], [], [], []],
        entryCount: 0,
        totalMin: 0,
        invoicedCount: 0,
        invoicedState: "none",
        hasRunning: false,
        hasCollision: false,
      };
      byKey.set(key, line);
    }

    const dur = entry.duration_min ?? 0;
    line.byDay[dayIndex] = (line.byDay[dayIndex] ?? 0) + dur;
    line.totalMin += dur;
    line.entryCount += 1;
    line.entriesByDay[dayIndex]?.push(entry);
    if (entry.end_time === null) line.hasRunning = true;
    if (entry.invoiced && entry.invoice_id != null) {
      line.invoicedByDay[dayIndex] = true;
      line.invoicedCount += 1;
      if (line.invoiceIdByDay[dayIndex] === null) {
        line.invoiceIdByDay[dayIndex] = entry.invoice_id;
      }
    }
  }

  const lines = Array.from(byKey.values());
  for (const line of lines) {
    line.hasCollision = line.entriesByDay.some((day) => day.length > 1);
    line.invoicedState =
      line.invoicedCount === 0
        ? "none"
        : line.invoicedCount === line.entryCount
          ? "all"
          : "partial";
  }
  // `lines` is already in earliest-start-time order (Map preserves the
  // first-insert order, and `flat` was sorted by start_time/id), so the
  // line order is deterministic without a second sort.
  return lines;
}
