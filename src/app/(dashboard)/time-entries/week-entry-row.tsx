"use client";

/**
 * Per-entry sub-rows for the weekly timesheet. When the user expands
 * a (project, category, user) parent row, the child entries render
 * as real `<tr>`s in the same `<tbody>` rather than the previous
 * popup-form drawer. Persona reviewers (UX, solo, agency, a11y) all
 * recommended this over a flat per-entry grid: keeps the parent
 * row's speed-cell typing for single-entry rows while letting
 * multi-entry rows expose every entry inline for scan + edit.
 *
 * Layout contract:
 *   - Summary `<tr>` shares the table's <colgroup> grid (220 lead +
 *     7×72 day + 80 total + 72 actions) so column widths don't
 *     shift across the expand/collapse toggle.
 *   - Edit `<tr>` (toggled per-entry) uses colSpan across all 10
 *     columns. The colSpan doesn't rebalance widths — `<col>`-owned
 *     widths still drive layout — it just collapses the row into
 *     one big cell for a wider description / ticket field.
 *   - Add-entry form follows the same colSpan drawer pattern.
 *
 * Authorship rule: every sub-row renders the entry's <Avatar>
 * because the time-entry-authorship CLAUDE.md rule applies to
 * EVERY surface that surfaces a time_entries row.
 *
 * Named `week-entry-row` (not `entry-row`) to avoid colliding with
 * the Day view's `entry-row.tsx` — these are separate components
 * for separate viewports.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Play,
  Plus,
  Square,
  Trash2,
  Pencil,
  Save,
  Lock,
  X,
  Link as LinkIcon,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { AlertBanner } from "@theshyre/ui";
import { EntryAuthor } from "@/components/EntryAuthor";
import { useFormAction } from "@/hooks/use-form-action";
import { useFormDirty } from "@/hooks/use-form-dirty";
import { SubmitButton } from "@/components/SubmitButton";
import { TicketField } from "@/components/TicketField";
import { Tooltip } from "@/components/Tooltip";
import {
  inputClass,
  selectClass,
  buttonGhostClass,
  labelClass,
} from "@/lib/form-styles";
import { formatDurationHMZero } from "@/lib/time/week";
import { localDayBoundsIso } from "@/lib/local-day-bounds";
import { notifyTimerChanged } from "@/lib/timer-events";
import {
  createTimeEntryAction,
  deleteTimeEntryAction,
  startTimerAction,
  stopTimerAction,
  updateTimeEntryAction,
  updateTimeEntryDurationAction,
} from "./actions";
import { DurationInput } from "./duration-input";
import type { TitleLine } from "./group-entries-by-title";
import type { ProjectOption, TimeEntry } from "./types";

const DAYS_IN_WEEK = 7;

/** Per-day cell input class — empty (create) variant. Shared by
 *  EntrySummaryRow and TitleLineRow so the two never drift. */
const EMPTY_CELL_INPUT_CLASS =
  "w-20 -mr-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-body font-mono text-right outline-none transition-colors hover:border-edge-muted focus:border-focus-ring focus:bg-surface-raised focus:ring-2 focus:ring-focus-ring/30 placeholder:text-content-muted";

/** Per-day cell input class — edit (existing duration) variant. */
const EDIT_CELL_INPUT_CLASS =
  "w-20 -mr-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-body font-mono outline-none transition-colors hover:border-edge-muted focus:border-focus-ring focus:bg-surface-raised focus:ring-2 focus:ring-focus-ring/30";

/** Cell column count used for colSpan on edit / add drawers. */
const TOTAL_COLS = DAYS_IN_WEEK + 3; // lead + 7 days + total + actions

interface EntrySummaryRowProps {
  entry: TimeEntry;
  /** Index of the entry's day within the visible week (0..6). */
  dayIndex: number;
  /** True when this entry is currently being edited; the consumer
   *  renders an `<EntryEditRow>` after this row when so. */
  editing: boolean;
  /** Toggle edit mode for this entry. */
  onEditToggle: () => void;
  /** Pre-formatted weekday + month + day for the entry's date —
   *  used in the per-day cell's aria-label so AT users hear
   *  "Tuesday May 5 — 1h 19m" instead of an isolated duration. */
  dayDateLong: string;
  /** When the running entry hits this row, the running indicator
   *  treatment lights up. */
  isRunning: boolean;
  liveElapsedMin: number;
  /** Customer-color rail painted on the leading cell so the parent
   *  row's customer band continues through its expanded sub-rows.
   *  Undefined when the parent row doesn't carry a rail (groupings
   *  other than Member). */
  customerRail?: string;
  /** Per-day cell-commit handler — same callback the parent row uses.
   *  When provided, the non-entry-day cells become editable: typing a
   *  duration upserts a NEW entry on that day for the same (project,
   *  category, user). Without this prop, those cells stay read-only
   *  `·` placeholders. */
  onCellCommit?: (dayIndex: number, minutes: number) => void | Promise<void>;
  /** Pre-formatted long-form date string per visible day, used in the
   *  empty-cell DurationInput aria-label so AT users hear the day
   *  they're committing into. Length 7; entry-day index doubles up. */
  dayDatesLong?: string[];
}

export function EntrySummaryRow({
  entry,
  dayIndex,
  editing,
  onEditToggle,
  dayDateLong,
  isRunning,
  liveElapsedMin,
  customerRail,
  onCellCommit,
  dayDatesLong,
}: EntrySummaryRowProps): React.JSX.Element {
  const t = useTranslations("time.entryRow");
  const tLock = useTranslations("time.lock");
  const del = useFormAction({ action: deleteTimeEntryAction });
  const start = useFormAction({ action: startTimerAction });
  const stop = useFormAction({ action: stopTimerAction });

  const locked = entry.invoiced && entry.invoice_id != null;
  const ticketKey = entry.linked_ticket_key;
  const ticketUrl = entry.linked_ticket_url;
  const description = entry.description ?? "";
  const durationDisplay = formatDurationHMZero(
    isRunning
      ? (entry.duration_min ?? 0) + liveElapsedMin
      : entry.duration_min ?? 0,
  );

  // Identifying label for the entry — used in tooltip + aria-label
  // on the per-entry play / stop button so screen-reader users hear
  // which entry the action targets.
  const entryLabel =
    ticketKey && description
      ? `${ticketKey} ${description}`
      : ticketKey ?? description ?? t("untitled");

  const handleStart = (): void => {
    const fd = new FormData();
    fd.set("resume_entry_id", entry.id);
    const [dayStart, dayEnd] = localDayBoundsIso();
    fd.set("day_start_iso", dayStart);
    fd.set("day_end_iso", dayEnd);
    void (async () => {
      await start.handleSubmit(fd);
      notifyTimerChanged();
    })();
  };

  const handleStop = (): void => {
    const fd = new FormData();
    fd.set("id", entry.id);
    void (async () => {
      await stop.handleSubmit(fd);
      notifyTimerChanged();
    })();
  };

  return (
    <tr
      className={`bg-surface ${
        isRunning
          ? "ring-2 ring-inset ring-success/40 bg-success-soft/20"
          : "border-b border-edge-muted/60"
      }`}
    >
      {/* Leading column: ↳ indent, avatar (per the time-entry-
          authorship rule), ticket chip, description. The chip is
          the primary identifier; the description truncates and
          shows in full via Tooltip. */}
      <td
        className={`py-1.5 align-middle ${customerRail ? "border-l-4 pl-1.5" : ""}`}
        style={customerRail ? { borderLeftColor: customerRail } : undefined}
      >
        <div className="flex items-center gap-1.5 pl-6 min-w-0">
          <span aria-hidden="true" className="text-content-muted">↳</span>
          {/* Authorship per the mandatory rule — every surface that
              surfaces a time_entries row renders the author. Compact
              mode shows just the avatar with name on hover so the
              sub-row stays scannable. */}
          <EntryAuthor author={entry.author} size={16} compact />
          {ticketKey ? (
            ticketUrl ? (
              <a
                href={ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("ticketLinkAria", { key: ticketKey })}
                className="inline-flex items-center gap-1 font-mono text-body text-accent shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
                {ticketKey}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-body text-accent shrink-0">
                <LinkIcon size={12} aria-hidden="true" className="shrink-0" />
                {ticketKey}
              </span>
            )
          ) : null}
          {/* Truncated description with the full text reachable to
              screen readers via an sr-only companion. The Tooltip
              alone is insufficient — its aria-describedby fires only
              while the trigger is focused, and the visual <span> is
              not focusable, so SR users never hear the full
              description. WCAG 1.4.13 / 4.1.2. */}
          <Tooltip label={description || t("untitled")}>
            <span
              className="text-body text-content-secondary truncate min-w-0"
              aria-hidden="true"
            >
              {description || (
                <span className="italic text-content-muted">
                  {t("untitled")}
                </span>
              )}
            </span>
          </Tooltip>
          <span className="sr-only">
            {description || t("untitled")}
          </span>
        </div>
      </td>
      {/* Day cells: blank except the entry's day, which shows the
          entry's individual duration. Editable when the entry isn't
          running and isn't invoice-locked — typing a new H:MM commits
          via updateTimeEntryDurationAction (preserves start_time,
          recomputes end). Running entries stay live (read-only with
          live tick); locked entries stay read-only (the trigger
          would refuse anyway). Type 0 to soft-delete the entry. */}
      {Array.from({ length: DAYS_IN_WEEK }, (_, i) => {
        if (i !== dayIndex) {
          // Other days — editable when the parent passes a cell-commit
          // handler AND the entry isn't locked (invoiced rows are
          // off-limits per the DB trigger). Typing a duration here
          // creates a new entry on (project, category, user, that day)
          // via the same upsert path the parent row uses. Without a
          // cell-commit handler, the cell stays a read-only `·`
          // placeholder. Locked / running entries never get this
          // affordance — the parent row already handles those cases.
          if (onCellCommit && !locked) {
            const cellDate = dayDatesLong?.[i];
            return (
              <td key={i} className="px-2 py-1.5 align-middle">
                <label className="flex justify-end cursor-text">
                  <DurationInput
                    name={`entry-${entry.id}-day-${i}`}
                    defaultMinutes={0}
                    ariaLabel={
                      cellDate
                        ? t("durationOnDay", { date: cellDate, duration: "" })
                        : undefined
                    }
                    onCommit={(committed) => {
                      if (committed === null) return;
                      if (committed === 0) return;
                      void onCellCommit(i, committed);
                    }}
                    placeholder="·"
                    className="w-20 -mr-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-body font-mono text-right outline-none transition-colors hover:border-edge-muted focus:border-focus-ring focus:bg-surface-raised focus:ring-2 focus:ring-focus-ring/30 placeholder:text-content-muted"
                  />
                </label>
              </td>
            );
          }
          return (
            <td key={i} className="px-2 py-1.5 align-middle text-right">
              <span className="text-content-muted" aria-hidden="true">
                ·
              </span>
            </td>
          );
        }
        if (isRunning || locked) {
          return (
            <td
              key={i}
              className="px-2 py-1.5 align-middle text-right"
              aria-label={t("durationOnDay", {
                date: dayDateLong,
                duration: durationDisplay,
              })}
            >
              <span className="inline-flex items-center justify-end gap-1.5 font-mono text-body tabular-nums text-content">
                {isRunning && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
                    aria-hidden="true"
                  />
                )}
                {durationDisplay}
              </span>
            </td>
          );
        }
        return (
          <td key={i} className="px-2 py-1.5 align-middle">
            <label className="flex justify-end cursor-text">
              <DurationInput
                name={`entry-${entry.id}-duration`}
                defaultMinutes={entry.duration_min ?? 0}
                ariaLabel={t("durationOnDay", {
                  date: dayDateLong,
                  duration: durationDisplay,
                })}
                onCommit={(committed) => {
                  if (committed === null) return;
                  if (committed === (entry.duration_min ?? 0)) return;
                  const fd = new FormData();
                  fd.set("id", entry.id);
                  fd.set("duration_min", String(committed));
                  void updateTimeEntryDurationAction(fd);
                }}
                className="w-20 -mr-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-body font-mono outline-none transition-colors hover:border-edge-muted focus:border-focus-ring focus:bg-surface-raised focus:ring-2 focus:ring-focus-ring/30"
              />
            </label>
          </td>
        );
      })}
      {/* Total column: each entry falls on a single day so this
          equals the day cell's duration. Kept for grid alignment. */}
      <td className="px-2 py-1.5 align-middle text-right font-mono text-body tabular-nums text-content-muted">
        {durationDisplay}
      </td>
      {/* Actions column: edit toggle + delete (or lock indicator
          for invoiced entries). */}
      <td className="px-2 py-1.5 align-middle">
        <div className="flex items-center justify-end gap-1">
          {locked ? (
            <Tooltip label={tLock("locked")}>
              <Link
                href={`/invoices/${entry.invoice_id}`}
                aria-label={tLock("locked")}
                className="rounded p-1 text-warning hover:bg-warning-soft transition-colors"
              >
                <Lock size={14} aria-hidden="true" />
              </Link>
            </Tooltip>
          ) : (
            <>
              {/* Per-entry Play / Stop. Targets THIS specific entry
                  (resume_entry_id) instead of the row-level Play
                  which picks the most-recently-completed entry on
                  (project, category) for today. Running entries
                  show a red Stop button; completed entries show a
                  ghost Play button — clicking on a completed entry
                  resumes it (backdates start_time when it's on
                  today; clones forward to today otherwise). */}
              {isRunning ? (
                <Tooltip label={t("stopEntry", { entry: entryLabel })}>
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stop.pending}
                    aria-label={t("stopEntry", { entry: entryLabel })}
                    className="rounded p-1 text-error-text hover:bg-error-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                  >
                    <Square size={14} className="fill-current" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip label={t("startEntry", { entry: entryLabel })}>
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={start.pending}
                    aria-label={t("startEntry", { entry: entryLabel })}
                    className="rounded p-1 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    <Play size={14} />
                  </button>
                </Tooltip>
              )}
              <Tooltip
                label={editing ? t("collapseEdit") : t("editEntry")}
              >
                <button
                  type="button"
                  onClick={onEditToggle}
                  aria-expanded={editing}
                  aria-controls={`entry-edit-${entry.id}`}
                  aria-label={t("editEntry")}
                  className={`rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    editing
                      ? "bg-accent-soft text-accent"
                      : "text-content-muted hover:bg-hover hover:text-accent"
                  }`}
                >
                  <Pencil size={14} />
                </button>
              </Tooltip>
              <Tooltip label={t("deleteEntry")}>
                <button
                  type="button"
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("id", entry.id);
                    void del.handleSubmit(fd);
                  }}
                  disabled={del.pending}
                  aria-label={t("deleteEntry")}
                  className="rounded p-1 text-content-muted hover:bg-error-soft hover:text-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

interface TitleLineRowProps {
  /** The merged title aggregation — its 7-day matrix and underlying
   *  entries. Only rendered for lines with >1 entry; a single-entry
   *  line renders as a plain EntrySummaryRow (it IS today's row). */
  line: TitleLine;
  /** True when the per-entry disclosure beneath this line is open. The
   *  parent renders the underlying EntrySummaryRows when so. */
  expanded: boolean;
  onToggle: () => void;
  /** Stable id linking the chevron's aria-controls to the revealed
   *  entry rows. */
  controlsId: string;
  /** Long-form date per visible day (length 7) for cell aria-labels. */
  dayDatesLong: string[];
  /** ISO start of the row's running entry, or null. Drives the live
   *  tick on a running cell. */
  runningStartIso: string | null;
  /** Shared 1 Hz ticker from the parent row — reused so render stays
   *  pure (no Date.now() in render) and the tick can't drift. */
  runningNowMs: number;
  customerRail?: string;
  /** Create-on-empty-day handler — typing into a 0-entry cell upserts a
   *  new entry on (project, category, user, that day). Single-entry
   *  cells edit by entry id directly (never the upsert path), and 2+
   *  cells are read-only. */
  onCellCommit?: (dayIndex: number, minutes: number) => void | Promise<void>;
}

/**
 * One merged "task" line: entries that share a title (ticket +
 * description + billable) folded onto a single 7-day matrix row. This
 * is the "same title on one line" view — `AE-644` logged Mon/Tue/Wed
 * reads as one line `1:00 | 3:30 | 1:30` instead of three sub-rows.
 *
 * Cell edit model (the safety contract from the design review):
 *   - 0 entries  → editable, creates a new same-title entry on that day.
 *   - 1 entry    → editable, edits THAT entry by id (never the cell
 *                  upsert, which could hard-collapse a sibling).
 *   - 1 invoiced → read-only with a lock mark.
 *   - 1 running  → read-only live tick.
 *   - 2+ entries → read-only sum; the cell is a button that opens the
 *                  per-entry disclosure, because a sum has no single
 *                  edit target. Such a line auto-expands on first paint.
 *
 * Single author by construction (the parent row is per-user), so the
 * one avatar satisfies the authorship rule.
 */
export function TitleLineRow({
  line,
  expanded,
  onToggle,
  controlsId,
  dayDatesLong,
  runningStartIso,
  runningNowMs,
  customerRail,
  onCellCommit,
}: TitleLineRowProps): React.JSX.Element {
  const t = useTranslations("time.entryRow");
  const tTitle = useTranslations("time.titleLine");
  const tLock = useTranslations("time.lock");

  const ticketKey = line.ticketKey;
  const ticketUrl = line.ticketUrl;
  const description = line.description ?? "";
  const allEntries = line.entriesByDay.flat();
  const author = allEntries[0]?.author ?? null;

  /** Live-elapsed minutes for a running entry, 0 otherwise. Uses the
   *  parent's shared ticker so it never drifts from the parent cell. */
  const liveFor = (e: TimeEntry): number =>
    e.end_time === null && runningStartIso !== null
      ? Math.max(
          0,
          Math.floor(
            (runningNowMs - new Date(e.start_time).getTime()) / 60_000,
          ),
        )
      : 0;

  const liveTotalMin =
    line.totalMin + allEntries.reduce((s, e) => s + liveFor(e), 0);

  const renderDayCell = (d: number): React.JSX.Element => {
    const entries = line.entriesByDay[d] ?? [];
    const count = entries.length;
    const cellDate = dayDatesLong[d];

    if (count === 0) {
      if (onCellCommit) {
        return (
          <td key={d} className="px-2 py-1.5 align-middle">
            <label className="flex justify-end cursor-text">
              <DurationInput
                name={`title-${controlsId}-day-${d}`}
                defaultMinutes={0}
                ariaLabel={
                  cellDate
                    ? t("durationOnDay", { date: cellDate, duration: "" })
                    : undefined
                }
                onCommit={(committed) => {
                  if (committed === null || committed === 0) return;
                  void onCellCommit(d, committed);
                }}
                placeholder="·"
                className={EMPTY_CELL_INPUT_CLASS}
              />
            </label>
          </td>
        );
      }
      return (
        <td key={d} className="px-2 py-1.5 align-middle text-right">
          <span className="text-content-muted" aria-hidden="true">
            ·
          </span>
        </td>
      );
    }

    if (count === 1) {
      const e = entries[0]!;
      const running = e.end_time === null && runningStartIso !== null;
      const locked = e.invoiced && e.invoice_id != null;
      const display = formatDurationHMZero(
        (e.duration_min ?? 0) + liveFor(e),
      );
      if (running || locked) {
        return (
          <td
            key={d}
            className="px-2 py-1.5 align-middle text-right"
            aria-label={
              locked
                ? tTitle("lockedCellAria", {
                    date: cellDate ?? "",
                    duration: display,
                  })
                : t("durationOnDay", {
                    date: cellDate ?? "",
                    duration: display,
                  })
            }
          >
            <span className="inline-flex items-center justify-end gap-1.5 font-mono text-body tabular-nums text-content">
              {running && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
                  aria-hidden="true"
                />
              )}
              {locked && (
                <Lock size={11} className="text-warning" aria-hidden="true" />
              )}
              {display}
            </span>
          </td>
        );
      }
      // Editable — routes to the entry by id, NOT the cell upsert.
      return (
        <td key={d} className="px-2 py-1.5 align-middle">
          <label className="flex justify-end cursor-text">
            <DurationInput
              name={`title-entry-${e.id}-duration`}
              defaultMinutes={e.duration_min ?? 0}
              ariaLabel={t("durationOnDay", {
                date: cellDate ?? "",
                duration: display,
              })}
              onCommit={(committed) => {
                if (committed === null) return;
                if (committed === (e.duration_min ?? 0)) return;
                const fd = new FormData();
                fd.set("id", e.id);
                fd.set("duration_min", String(committed));
                void updateTimeEntryDurationAction(fd);
              }}
              className={EDIT_CELL_INPUT_CLASS}
            />
          </label>
        </td>
      );
    }

    // 2+ entries on one day — the ambiguous cell. Read-only sum; the
    // button opens the per-entry disclosure so each can be edited.
    const cellLive = entries.reduce((s, e) => s + liveFor(e), 0);
    const display = formatDurationHMZero((line.byDay[d] ?? 0) + cellLive);
    return (
      <td key={d} className="px-2 py-1.5 align-middle text-right">
        <Tooltip label={tTitle("summedTooltip", { count })}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={controlsId}
            aria-label={tTitle("summedAria", {
              date: cellDate ?? "",
              duration: display,
              count,
            })}
            className="font-mono text-body tabular-nums text-content underline decoration-dotted decoration-content-muted underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-0.5"
          >
            {display}
          </button>
        </Tooltip>
      </td>
    );
  };

  return (
    <tr className="bg-surface border-b border-edge-muted/60">
      {/* Leading cell: expand chevron, author, ticket chip, truncated
          description, entry-count badge, and the line-level invoiced
          indicator (none/partial/all). The chevron replaces the ↳ glyph
          — this line IS a parent for its entries. */}
      <td
        className={`py-1.5 align-middle ${customerRail ? "border-l-4 pl-1.5" : ""}`}
        style={customerRail ? { borderLeftColor: customerRail } : undefined}
      >
        <div className="flex items-center gap-1.5 pl-6 min-w-0">
          <Tooltip
            label={expanded ? tTitle("collapseLine") : tTitle("expandLine")}
          >
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={controlsId}
              aria-label={tTitle("expandLineAria", { count: line.entryCount })}
              className="inline-flex shrink-0 items-center rounded p-0.5 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          </Tooltip>
          <EntryAuthor author={author} size={16} compact />
          {ticketKey ? (
            ticketUrl ? (
              <a
                href={ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("ticketLinkAria", { key: ticketKey })}
                className="inline-flex items-center gap-1 font-mono text-body text-accent shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
                {ticketKey}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-body text-accent shrink-0">
                <LinkIcon size={12} aria-hidden="true" className="shrink-0" />
                {ticketKey}
              </span>
            )
          ) : null}
          <Tooltip label={description || t("untitled")}>
            <span
              className="text-body text-content-secondary truncate min-w-0"
              aria-hidden="true"
            >
              {description || (
                <span className="italic text-content-muted">
                  {t("untitled")}
                </span>
              )}
            </span>
          </Tooltip>
          <span className="sr-only">{description || t("untitled")}</span>
          {/* Entry-count badge — text channel telling the user there's
              per-entry detail folded behind this line. */}
          <Tooltip label={tTitle("entriesBadge", { count: line.entryCount })}>
            <span
              className="shrink-0 rounded-full bg-surface-inset px-1.5 text-caption font-medium tabular-nums text-content-muted"
              aria-hidden="true"
            >
              {line.entryCount}
            </span>
          </Tooltip>
          {line.invoicedState !== "none" && (
            <Tooltip
              label={tTitle("invoicedDetail", {
                invoiced: line.invoicedCount,
                count: line.entryCount,
              })}
            >
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded px-1 text-caption font-medium ${
                  line.invoicedState === "all"
                    ? "text-warning"
                    : "text-warning/80"
                }`}
              >
                <Lock size={11} aria-hidden="true" />
                {line.invoicedState === "all"
                  ? tLock("locked")
                  : tTitle("partialInvoiced")}
              </span>
            </Tooltip>
          )}
        </div>
      </td>
      {Array.from({ length: DAYS_IN_WEEK }, (_, d) => renderDayCell(d))}
      {/* Total — sum across the line's days, the number the user asked
          to see on one line. */}
      <td className="px-2 py-1.5 align-middle text-right font-mono text-body tabular-nums text-content">
        {formatDurationHMZero(liveTotalMin)}
      </td>
      {/* Actions: intentionally empty. Per-entry play / edit / delete
          live on the revealed EntrySummaryRows — a merged line has no
          single action target. The chevron in the leading cell is the
          only control. */}
      <td className="px-2 py-1.5" aria-hidden="true" />
    </tr>
  );
}

interface EntryEditRowProps {
  entry: TimeEntry;
  project: ProjectOption | undefined;
  /** Full project list — the project picker offers same-team
   *  projects, so the caller passes the page's already-fetched
   *  list rather than re-fetching here. */
  projects: ProjectOption[];
  tzOffsetMin?: number;
  /** Locale-formatted long-form date string for the edit form's
   *  metadata strip header. */
  dayDateLong: string;
  onClose: () => void;
}

export function EntryEditRow({
  entry,
  project,
  projects,
  tzOffsetMin,
  dayDateLong,
  onClose,
}: EntryEditRowProps): React.JSX.Element {
  const t = useTranslations("time.entryRow");
  const tc = useTranslations("common");

  // Tracks the picked destination project so the user can move this
  // entry to a sub-project (or any same-team project). Same-team
  // filtering is server-enforced too — the picker here just hides
  // cross-team options.
  const [selectedProjectId, setSelectedProjectId] = useState(entry.project_id);
  // Only offer projects on the entry's team. The page already scopes
  // to the active team, so the list IS the team's projects, but a
  // defensive same-team filter guards against future plumbing
  // accidents.
  const sameTeamProjects = projects.filter(
    (p) => p.team_id === entry.team_id,
  );
  const projectChanging = selectedProjectId !== entry.project_id;
  // Invoiced entries can't be moved — the DB trigger refuses writes.
  // Disable the picker so the UI doesn't accept input it can't honor.
  const locked = entry.invoiced && entry.invoice_id != null;

  const update = useFormAction({
    action: updateTimeEntryAction,
    onSuccess: () => onClose(),
  });
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useFormDirty(formRef, update.success);

  // Focus on open: first editable input. Esc closes (the parent
  // table also routes Esc up to collapse the row, but having the
  // row-local handler keeps focus management predictable when
  // multiple entries are editing at once).
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLInputElement>("input[name='description']")
      ?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const linkedTicket =
    entry.linked_ticket_provider && entry.linked_ticket_key
      ? {
          provider: entry.linked_ticket_provider,
          key: entry.linked_ticket_key,
          url: entry.linked_ticket_url,
          title: entry.linked_ticket_title,
        }
      : null;

  return (
    <tr id={`entry-edit-${entry.id}`}>
      {/* colSpan over all visible columns — `<col>` widths still
          drive the table; this just merges the cells for a wider
          edit form than 220px would allow. The aggregate row's
          column structure is unchanged, so toggling this drawer
          doesn't shift the rest of the grid. */}
      <td
        colSpan={TOTAL_COLS}
        className="bg-surface-raised px-4 py-3 border-b border-edge-muted/60"
      >
        <form
          ref={formRef}
          action={update.handleSubmit}
          onKeyDown={handleKeyDown}
          className="space-y-3"
        >
          <input type="hidden" name="id" value={entry.id} />
          {tzOffsetMin !== undefined && (
            <input
              type="hidden"
              name="tz_offset_min"
              value={String(tzOffsetMin)}
            />
          )}

          {update.serverError && (
            <AlertBanner tone="error">{update.serverError}</AlertBanner>
          )}

          <p className="text-caption text-content-muted">
            {t("editingOn", { date: dayDateLong })}
          </p>

          <div className="space-y-3">
            {/* Project picker — supports "I forgot to create the
                sub-project, now I need to move this entry." Selecting
                a different project submits `project_id` and the
                action validates same-team + clears the category if
                the destination doesn't accept it. Disabled when the
                entry is locked (invoiced) since the DB trigger refuses
                writes regardless. */}
            <div>
              <label
                htmlFor={`entry-edit-project-${entry.id}`}
                className={labelClass}
              >
                {t("fields.project")}
              </label>
              {/* Uncontrolled select with defaultValue + onChange,
                  NOT a controlled `value={...}`. The parent
                  WeekTimesheet ticks every second when a timer is
                  running; controlled selects forced the DOM value
                  back to the React-state value on each render, and
                  if the user's pick raced the tick the picked value
                  was lost before React's setState committed. Going
                  uncontrolled means the browser owns the chosen
                  value (Safari + native `appearance:none` are
                  especially affected). State still tracks via
                  onChange for the move-hint + the form's dirty
                  check; on submit, FormData reads the DOM directly. */}
              <select
                id={`entry-edit-project-${entry.id}`}
                name="project_id"
                defaultValue={entry.project_id}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={locked}
                className={selectClass}
              >
                {sameTeamProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {projectChanging && (
                <p className="mt-1 text-caption text-content-muted italic">
                  {t("projectMoveHint")}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor={`entry-edit-desc-${entry.id}`}
                className={labelClass}
              >
                {t("fields.description")}
              </label>
              <input
                id={`entry-edit-desc-${entry.id}`}
                name="description"
                defaultValue={entry.description ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <TicketField
                idPrefix={`entry-edit-${entry.id}`}
                githubRepo={project?.github_repo ?? null}
                jiraProjectKey={project?.jira_project_key ?? null}
                attached={linkedTicket}
                entryId={entry.id}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-body text-content cursor-pointer">
              <input
                type="checkbox"
                name="billable"
                defaultChecked={entry.billable}
                className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
              />
              {t("fields.billable")}
            </label>
            <div className="flex items-center gap-2">
              <SubmitButton
                label={t("save")}
                pending={update.pending}
                icon={Save}
                success={update.success}
                successMessage={tc("actions.saved")}
                disabled={!dirty}
              />
              <button
                type="button"
                onClick={onClose}
                disabled={update.pending}
                className={buttonGhostClass}
              >
                <X size={14} />
                {tc("actions.cancel")}
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  );
}

interface AddEntryRowProps {
  project: ProjectOption | undefined;
  categoryId: string | null;
  /** Days in the visible week (YYYY-MM-DD) so the form can offer a
   *  day picker anchored to the parent row's week. */
  weekDays: string[];
  /** Default day for new entries — typically today, falling back to
   *  the most recent visible day. */
  defaultDayDateStr: string;
  tzOffsetMin?: number;
  onClose: () => void;
}

export function AddEntryRow({
  project,
  categoryId,
  weekDays,
  defaultDayDateStr,
  tzOffsetMin,
  onClose,
}: AddEntryRowProps): React.JSX.Element {
  const t = useTranslations("time.entryRow");
  const tc = useTranslations("common");

  const create = useFormAction({
    action: createTimeEntryAction,
    onSuccess: () => onClose(),
  });
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useFormDirty(formRef, create.success);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  if (!project) {
    return (
      <tr>
        <td colSpan={TOTAL_COLS} className="px-4 py-3">
          <p className="text-caption text-content-muted">
            {t("addEntryNoProject")}
          </p>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td
        colSpan={TOTAL_COLS}
        className="bg-accent-soft/20 px-4 py-3 border-b border-edge-muted/60"
      >
        <form
          ref={formRef}
          action={create.handleSubmit}
          onKeyDown={handleKeyDown}
          className="space-y-3"
        >
          <input type="hidden" name="project_id" value={project.id} />
          {project.team_id && (
            <input type="hidden" name="team_id" value={project.team_id} />
          )}
          {categoryId && (
            <input type="hidden" name="category_id" value={categoryId} />
          )}
          {tzOffsetMin !== undefined && (
            <input
              type="hidden"
              name="tz_offset_min"
              value={String(tzOffsetMin)}
            />
          )}

          {create.serverError && (
            <AlertBanner tone="error">{create.serverError}</AlertBanner>
          )}

          <p className="text-caption font-semibold uppercase tracking-wider text-accent">
            {t("addEntryHeader")}
          </p>

          <div className="space-y-3">
            <div>
              <label htmlFor="entry-add-desc" className={labelClass}>
                {t("fields.description")}
              </label>
              <input
                id="entry-add-desc"
                name="description"
                autoFocus
                placeholder={t("fields.descriptionPlaceholder")}
                className={inputClass}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <TicketField
                idPrefix="entry-add"
                githubRepo={project.github_repo}
                jiraProjectKey={project.jira_project_key}
              />
              <div className="min-w-[150px]">
                <label htmlFor="entry-add-date" className={labelClass}>
                  {t("fields.day")}
                </label>
                <select
                  id="entry-add-date"
                  name="entry_date"
                  defaultValue={defaultDayDateStr}
                  className={inputClass}
                >
                  {weekDays.map((d) => {
                    const parts = d.split("-").map(Number);
                    const label =
                      parts.length === 3 && !parts.some(Number.isNaN)
                        ? new Date(parts[0]!, parts[1]! - 1, parts[2]!)
                            .toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })
                        : d;
                    return (
                      <option key={d} value={d}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="min-w-[88px]">
                <label htmlFor="entry-add-duration" className={labelClass}>
                  {t("fields.duration")}
                </label>
                <DurationInput
                  name="duration_min"
                  defaultMinutes={0}
                  ariaLabel={t("fields.duration")}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-body text-content cursor-pointer">
              <input
                type="checkbox"
                name="billable"
                defaultChecked={
                  project.default_billable !== false && !project.is_internal
                }
                disabled={project.is_internal === true}
                className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring disabled:opacity-50"
              />
              {t("fields.billable")}
            </label>
            <div className="flex items-center gap-2">
              <SubmitButton
                label={t("addEntry")}
                pending={create.pending}
                icon={Plus}
                success={create.success}
                successMessage={tc("actions.saved")}
                disabled={!dirty}
              />
              <button
                type="button"
                onClick={onClose}
                disabled={create.pending}
                className={buttonGhostClass}
              >
                <X size={14} />
                {tc("actions.cancel")}
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  );
}

/** Given a row's entries (across all 7 days), emit a flat ordered
 *  list of (entry, dayIndex) pairs sorted by day then start time so
 *  summary rows render in chronological order. */
export function flattenEntriesByDay(
  entriesByDay: TimeEntry[][],
): Array<{ entry: TimeEntry; dayIndex: number }> {
  const out: Array<{ entry: TimeEntry; dayIndex: number }> = [];
  for (let d = 0; d < entriesByDay.length; d += 1) {
    const dayEntries = entriesByDay[d] ?? [];
    for (const entry of dayEntries) {
      out.push({ entry, dayIndex: d });
    }
  }
  out.sort((a, b) => a.entry.start_time.localeCompare(b.entry.start_time));
  return out;
}

/** True when the row should auto-expand on first paint per the
 *  smart-default rule: any visible day has more than one entry on
 *  this (project, category, user) row. Single-entry rows stay
 *  collapsed so the speed-cell typing model still works. */
export function shouldAutoExpand(entriesByDay: TimeEntry[][]): boolean {
  return entriesByDay.some((day) => day.length > 1);
}
