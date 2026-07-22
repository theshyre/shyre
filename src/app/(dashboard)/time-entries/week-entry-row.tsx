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
import { TicketField } from "./ticket-field";
import { Tooltip } from "@/components/Tooltip";
import {
  inputClass,
  selectClass,
  textareaClass,
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
import { CategoryPicker } from "./category-picker";
import { AutoTextarea } from "@/components/AutoTextarea";
import {
  displayDescription,
  deriveAgentAttribution,
  type TitleLine,
} from "./group-entries-by-title";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

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
  // Visible/sr-only text drops a leading ticket-key prefix (the chip
  // already shows the key); entryLabel below keeps the full text.
  const descDisplay = displayDescription(ticketKey, entry.description);
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
          {/* Fixed-width leading slot so the ↳ glyph aligns with the
              TitleLineRow chevron — avatars/chips form one column across
              merged and single task lines. */}
          <span
            aria-hidden="true"
            className="flex w-[22px] shrink-0 justify-center text-content-muted"
          >
            ↳
          </span>
          {/* Authorship per the mandatory rule — every surface that
              surfaces a time_entries row renders the author. Compact
              mode shows just the avatar with name on hover so the
              sub-row stays scannable. */}
          <EntryAuthor
            author={entry.author}
            size={16}
            compact
            startedByKind={entry.started_by_kind}
            agentLabel={entry.agent_label}
          />
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
          <Tooltip label={descDisplay || t("untitled")}>
            <span
              className="text-body text-content-secondary truncate min-w-0"
              aria-hidden="true"
            >
              {descDisplay || (
                <span className="italic text-content-muted">
                  {t("untitled")}
                </span>
              )}
            </span>
          </Tooltip>
          <span className="sr-only">
            {descDisplay || t("untitled")}
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
            <Tooltip label={tLock("locked")} labelMode="label">
              <Link
                href={`/invoices/${entry.invoice_id}`}
                className="rounded p-1 text-warning-text hover:bg-warning-soft transition-colors"
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
                <Tooltip label={t("stopEntry", { entry: entryLabel })} labelMode="label">
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stop.pending}
                    className="rounded p-1 text-error-text hover:bg-error-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                  >
                    <Square size={14} className="fill-current" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip label={t("startEntry", { entry: entryLabel })} labelMode="label">
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={start.pending}
                    className="rounded p-1 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    <Play size={14} />
                  </button>
                </Tooltip>
              )}
              <Tooltip
                label={editing ? t("collapseEdit") : t("editEntry")}
                labelMode="label"
              >
                <button
                  type="button"
                  onClick={onEditToggle}
                  aria-expanded={editing}
                  aria-controls={`entry-edit-${entry.id}`}
                  className={`rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    editing
                      ? "bg-accent-soft text-accent"
                      : "text-content-muted hover:bg-hover hover:text-accent"
                  }`}
                >
                  <Pencil size={14} />
                </button>
              </Tooltip>
              <Tooltip label={t("deleteEntry")} labelMode="label">
                <button
                  type="button"
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("id", entry.id);
                    void del.handleSubmit(fd);
                  }}
                  disabled={del.pending}
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
  /** Create-on-empty-day handler — typing into a 0-entry cell creates a
   *  NEW entry carrying THIS title's identity (ticket + description +
   *  billable) on that day. Distinct from the row-level upsert, which is
   *  keyed only on (project, category, day) and would hit a different
   *  title's entry sharing the cell. Single-entry cells edit by entry id
   *  directly; 2+ cells are read-only. */
  onCellCreate?: (dayIndex: number, minutes: number) => void | Promise<void>;
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
  onCellCreate,
}: TitleLineRowProps): React.JSX.Element {
  const t = useTranslations("time.entryRow");
  const tTitle = useTranslations("time.titleLine");
  const tLock = useTranslations("time.lock");

  const ticketKey = line.ticketKey;
  const ticketUrl = line.ticketUrl;
  const desc = displayDescription(ticketKey, line.description);
  // Names the task in the expand control's accessible name so SR users
  // hear "Show 3 entries on AE-644" rather than a context-free "this
  // task" — the scoped a11y win in lieu of a full treegrid migration.
  const taskName = ticketKey ?? (desc || t("untitled"));
  const allEntries = line.entriesByDay.flat();
  const author = allEntries[0]?.author ?? null;
  // Agent attribution rollup — if any folded entry was agent-started,
  // the merged line carries the Bot badge (SAL-051, display-only).
  const agentAttribution = deriveAgentAttribution(allEntries);
  const invoicedLabel =
    line.invoicedState === "all"
      ? tLock("locked")
      : tTitle("invoicedDetail", {
          invoiced: line.invoicedCount,
          count: line.entryCount,
        });

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
      if (onCellCreate) {
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
                  void onCellCreate(d, committed);
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
          {/* Fixed-width leading slot — same width as EntrySummaryRow's
              ↳ slot so avatars/chips align into one column. */}
          <span className="flex w-[22px] shrink-0 justify-center">
            <Tooltip
              label={expanded ? tTitle("collapseLine") : tTitle("expandLine")}
            >
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={controlsId}
                aria-label={tTitle("expandLineAria", {
                  count: line.entryCount,
                  task: taskName,
                })}
                className="inline-flex shrink-0 items-center rounded p-1 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            </Tooltip>
          </span>
          <EntryAuthor
            author={author}
            size={16}
            compact
            startedByKind={agentAttribution?.startedByKind}
            agentLabel={agentAttribution?.agentLabel}
            rollup
          />
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
          <Tooltip label={desc || t("untitled")}>
            <span
              className="text-body text-content-secondary truncate min-w-0"
              aria-hidden="true"
            >
              {desc || (
                <span className="italic text-content-muted">
                  {t("untitled")}
                </span>
              )}
            </span>
          </Tooltip>
          <span className="sr-only">{desc || t("untitled")}</span>
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
          {/* Invoiced indicator — icon-only to spare the description.
              `all` = lock alone (icon + color, 2 channels); `partial`
              adds an invoiced/total fraction (3rd channel) so it's
              distinguishable from `all` without relying on color. The
              per-day cells already carry their own lock glyphs. */}
          {line.invoicedState !== "none" && (
            <Tooltip label={invoicedLabel}>
              <span
                className="inline-flex shrink-0 items-center gap-0.5 text-warning"
                aria-label={invoicedLabel}
              >
                <Lock size={11} aria-hidden="true" />
                {line.invoicedState === "partial" && (
                  <span
                    className="text-caption font-medium tabular-nums"
                    aria-hidden="true"
                  >
                    {line.invoicedCount}/{line.entryCount}
                  </span>
                )}
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

interface TitleLineDrawerProps {
  /** Underlying entries with their day index, in render order. */
  rows: Array<{ entry: TimeEntry; dayIndex: number }>;
  /** Matches the TitleLineRow chevron's `aria-controls`. */
  controlsId: string;
  /** Long-form date per visible day (length 7) for each entry's label. */
  dayDatesLong: string[];
  /** Identifying label for the merged task (region aria-label). */
  taskLabel: string;
  runningStartIso: string | null;
  runningNowMs: number;
  /** Which entry (if any) currently has its inline edit form open. */
  editingEntryId: string | null;
  onEditToggle: (entryId: string) => void;
  /** Collapse the disclosure (Escape). */
  onClose: () => void;
}

/**
 * Compact disclosure for a merged TitleLineRow's underlying entries. A
 * single colSpan `<tr>` (so the table stays at two expand levels and the
 * <col> grid still owns widths) holding a list where each entry shows
 * only what distinguishes it — its day, duration, and per-entry actions.
 * The ticket + description + 7-day matrix are NOT repeated; the title
 * line above already carries them. Author is shown once at the header.
 */
export function TitleLineDrawer({
  rows,
  controlsId,
  dayDatesLong,
  taskLabel,
  runningStartIso,
  runningNowMs,
  editingEntryId,
  onEditToggle,
  onClose,
}: TitleLineDrawerProps): React.JSX.Element {
  const tTitle = useTranslations("time.titleLine");
  const author = rows[0]?.entry.author ?? null;
  // Same rollup as the merged line this drawer expands from — the
  // header chip must not lose the Bot badge the line carries.
  const drawerAttribution = deriveAgentAttribution(
    rows.map((r) => r.entry),
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <tr id={controlsId}>
      <td
        colSpan={TOTAL_COLS}
        className="bg-surface-raised border-b border-edge-muted/60"
      >
        {/* Inline disclosure (not a modal): Escape-dismissible, focus not
            trapped — Tab flows on through to the next row. */}
        <div
          role="group"
          aria-label={tTitle("drawerLabel", { task: taskLabel })}
          onKeyDown={handleKeyDown}
          className="py-1.5 pl-12 pr-3"
        >
          {/* Author once, per the authorship rule — the merged line is
              single-author by construction. */}
          <div className="flex items-center gap-1.5 pb-1 text-caption text-content-muted">
            <EntryAuthor
              author={author}
              size={14}
              compact
              startedByKind={drawerAttribution?.startedByKind}
              agentLabel={drawerAttribution?.agentLabel}
              rollup
            />
            <span>{tTitle("drawerHeader", { count: rows.length })}</span>
          </div>
          <ul className="space-y-px">
            {rows.map(({ entry, dayIndex }) => (
              <DrawerEntryItem
                key={entry.id}
                entry={entry}
                dayDateLong={dayDatesLong[dayIndex] ?? ""}
                runningStartIso={runningStartIso}
                runningNowMs={runningNowMs}
                editing={editingEntryId === entry.id}
                onEditToggle={() => onEditToggle(entry.id)}
              />
            ))}
          </ul>
        </div>
      </td>
    </tr>
  );
}

interface DrawerEntryItemProps {
  entry: TimeEntry;
  dayDateLong: string;
  runningStartIso: string | null;
  runningNowMs: number;
  editing: boolean;
  onEditToggle: () => void;
}

/** One entry inside a TitleLineDrawer: `date · duration · actions`. No
 *  identity (the title line owns it); date is the distinguisher so every
 *  action's aria-label names the date. */
function DrawerEntryItem({
  entry,
  dayDateLong,
  runningStartIso,
  runningNowMs,
  editing,
  onEditToggle,
}: DrawerEntryItemProps): React.JSX.Element {
  const tTitle = useTranslations("time.titleLine");
  const tLock = useTranslations("time.lock");
  const tRunning = useTranslations("time.cellExpansion");
  const del = useFormAction({ action: deleteTimeEntryAction });
  const start = useFormAction({ action: startTimerAction });
  const stop = useFormAction({ action: stopTimerAction });

  const locked = entry.invoiced && entry.invoice_id != null;
  const isRunning = entry.end_time === null && runningStartIso !== null;
  const liveElapsed = isRunning
    ? Math.max(
        0,
        Math.floor((runningNowMs - new Date(entry.start_time).getTime()) / 60_000),
      )
    : 0;
  const durationDisplay = formatDurationHMZero(
    (entry.duration_min ?? 0) + liveElapsed,
  );

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
    <li
      className={`flex items-center gap-2 rounded px-2 py-1 ${
        isRunning ? "bg-success-soft/20" : ""
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-body text-content-secondary">
        {dayDateLong}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-body tabular-nums text-content">
        {isRunning && (
          <span className="inline-flex items-center gap-1 text-caption font-medium uppercase tracking-wider text-success">
            <span
              className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse"
              aria-hidden="true"
            />
            {tRunning("runningBadge")}
          </span>
        )}
        {durationDisplay}
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1">
        {locked ? (
          // Invoiced entries are immutable — the only affordance is a
          // labelled link to the invoice (icon + "Invoiced" word + the
          // invoice number when known), so the row reads as "billed,
          // view invoice" rather than an inert dead row.
          <Tooltip
            label={tLock("lockedOn", {
              invoice: entry.invoice_number ?? "—",
            })}
          >
            <Link
              href={`/invoices/${entry.invoice_id}`}
              aria-label={
                entry.invoice_number
                  ? tTitle("viewInvoiceAria", {
                      invoice: entry.invoice_number,
                      date: dayDateLong,
                    })
                  : tTitle("lockedCellAria", {
                      date: dayDateLong,
                      duration: durationDisplay,
                    })
              }
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-caption font-medium text-warning-text hover:bg-warning-soft hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Lock size={12} aria-hidden="true" className="shrink-0" />
              {tLock("locked")}
              {entry.invoice_number && (
                <span className="tabular-nums">· {entry.invoice_number}</span>
              )}
            </Link>
          </Tooltip>
        ) : (
          <>
            {isRunning ? (
              <Tooltip label={tTitle("drawerStopEntry", { date: dayDateLong })}>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stop.pending}
                  aria-label={tTitle("drawerStopEntry", { date: dayDateLong })}
                  className="rounded p-1 text-error-text hover:bg-error-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                >
                  <Square size={14} className="fill-current" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip label={tTitle("drawerResumeEntry", { date: dayDateLong })}>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={start.pending}
                  aria-label={tTitle("drawerResumeEntry", { date: dayDateLong })}
                  className="rounded p-1 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  <Play size={14} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={tTitle("drawerEditEntry", { date: dayDateLong })}>
              <button
                type="button"
                onClick={onEditToggle}
                aria-expanded={editing}
                aria-controls={`entry-edit-${entry.id}`}
                aria-label={tTitle("drawerEditEntry", { date: dayDateLong })}
                className={`rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  editing
                    ? "bg-accent-soft text-accent"
                    : "text-content-muted hover:bg-hover hover:text-accent"
                }`}
              >
                <Pencil size={14} />
              </button>
            </Tooltip>
            <Tooltip label={tTitle("drawerDeleteEntry", { date: dayDateLong })}>
              <button
                type="button"
                onClick={() => {
                  const fd = new FormData();
                  fd.set("id", entry.id);
                  void del.handleSubmit(fd);
                }}
                disabled={del.pending}
                aria-label={tTitle("drawerDeleteEntry", { date: dayDateLong })}
                className="rounded p-1 text-content-muted hover:bg-error-soft hover:text-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </>
        )}
      </span>
    </li>
  );
}

interface EntryEditRowProps {
  entry: TimeEntry;
  project: ProjectOption | undefined;
  /** Full project list — the project picker offers same-team
   *  projects, so the caller passes the page's already-fetched
   *  list rather than re-fetching here. */
  projects: ProjectOption[];
  /** All categories across sets — the picker filters to the selected
   *  project's base + extension set. */
  categories: CategoryOption[];
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
  categories,
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

  // Description is controlled so the AutoTextarea can grow to fit — a long
  // agent-logged summary shouldn't sit cramped in a single line.
  const [description, setDescription] = useState(entry.description ?? "");
  // The picked project drives which category set the picker offers and the
  // internal -> non-billable rule (mirrors InlineEditForm).
  const selectedProject =
    sameTeamProjects.find((p) => p.id === selectedProjectId) ?? project;
  const projectIsInternal = selectedProject?.is_internal === true;

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
      ?.querySelector<HTMLTextAreaElement>("textarea[name='description']")
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
            {/* Category — re-keyed on the picked project so it resets to
                that project's allowed set. Renders nothing when the project
                has no category set (hideWhenEmpty). */}
            <CategoryPicker
              key={selectedProjectId}
              categories={categories}
              categorySetIds={[
                selectedProject?.category_set_id,
                selectedProject?.extension_category_set_id,
              ]}
              defaultValue={
                selectedProjectId === entry.project_id
                  ? entry.category_id
                  : null
              }
              currentCategoryId={entry.category_id}
            />
            <div>
              <label
                htmlFor={`entry-edit-desc-${entry.id}`}
                className={labelClass}
              >
                {t("fields.description")}
              </label>
              {/* Auto-growing textarea — a single-line input truncated long
                  descriptions (e.g. agent-logged session summaries). */}
              <AutoTextarea
                id={`entry-edit-desc-${entry.id}`}
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                minRows={2}
                className={textareaClass}
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
            {(() => {
              const billableLabel = (
                <label
                  className={`flex items-center gap-2 text-body ${projectIsInternal ? "text-content-muted cursor-not-allowed" : "text-content cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    name="billable"
                    defaultChecked={entry.billable && !projectIsInternal}
                    disabled={projectIsInternal || locked}
                    className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring disabled:opacity-50"
                  />
                  {t("fields.billable")}
                </label>
              );
              return projectIsInternal ? (
                <Tooltip label={t("fields.billableInternalLocked")}>
                  {billableLabel}
                </Tooltip>
              ) : (
                billableLabel
              );
            })()}
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
