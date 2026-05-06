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

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Play,
  Plus,
  Square,
  Trash2,
  Pencil,
  Save,
  Lock,
  X,
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
import type { ProjectOption, TimeEntry } from "./types";

const DAYS_IN_WEEK = 7;

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
}

export function EntrySummaryRow({
  entry,
  dayIndex,
  editing,
  onEditToggle,
  dayDateLong,
  isRunning,
  liveElapsedMin,
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
      <td className="py-1.5 align-middle">
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
                className="font-mono text-caption text-accent shrink-0 hover:underline"
              >
                {ticketKey}
              </a>
            ) : (
              <span className="font-mono text-caption text-accent shrink-0">
                {ticketKey}
              </span>
            )
          ) : null}
          <Tooltip label={description || t("untitled")}>
            <span className="text-body text-content-secondary truncate min-w-0">
              {description || (
                <span className="italic text-content-muted">
                  {t("untitled")}
                </span>
              )}
            </span>
          </Tooltip>
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
          return (
            <td key={i} className="px-2 py-1.5 align-middle text-right">
              <span className="text-content-muted/50" aria-hidden="true">
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

interface EntryEditRowProps {
  entry: TimeEntry;
  project: ProjectOption | undefined;
  tzOffsetMin?: number;
  /** Locale-formatted long-form date string for the edit form's
   *  metadata strip header. */
  dayDateLong: string;
  onClose: () => void;
}

export function EntryEditRow({
  entry,
  project,
  tzOffsetMin,
  dayDateLong,
  onClose,
}: EntryEditRowProps): React.JSX.Element {
  const t = useTranslations("time.entryRow");
  const tc = useTranslations("common");

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
