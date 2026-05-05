"use client";

/**
 * Week-grid cell expansion editor — Phase 2 of the
 * Jira/GitHub-week-view rework. When the user clicks the chevron next
 * to a cell's duration in the weekly timesheet, a sub-row opens with
 * one editable mini-row per underlying entry, plus a "+ Add entry"
 * button to spawn a sibling. Reuses the auto-link ticket field from
 * `<TicketField>` so the same Jira/GitHub flow works from Week view.
 *
 * Why not reuse <InlineEditForm>?
 *   - InlineEditForm renders ~12 fields (project picker, category,
 *     start/end timestamps, duration, billable, ticket). Inside an
 *     expansion sub-row that needs to hold N of these, the visual
 *     density would crush the page.
 *   - The expansion is scoped: project + category + day are all
 *     fixed by the parent cell, so we can drop the picker chrome
 *     and focus on the editable bits (description, ticket, billable,
 *     duration). The full editor stays available via "Open full
 *     editor" link → /time-entries (Day view).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, X, ExternalLink, Save } from "lucide-react";
import Link from "next/link";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { TicketField } from "@/components/TicketField";
import {
  inputClass,
  buttonGhostClass,
  labelClass,
} from "@/lib/form-styles";
import {
  createTimeEntryAction,
  deleteTimeEntryAction,
  updateTimeEntryAction,
} from "./actions";
import { DurationInput } from "./duration-input";
import type { ProjectOption, TimeEntry } from "./types";

interface CellExpansionProps {
  /** Underlying entries for this (project, category, user, day) cell. */
  entries: TimeEntry[];
  project: ProjectOption | undefined;
  /** Category id for new sibling entries; undefined means the project
   *  doesn't require a category. */
  categoryId: string | null;
  /** YYYY-MM-DD for the day this cell represents. */
  dayDateStr: string;
  /** Locale-formatted long-form date for headers / aria-labels. */
  dayDateLong: string;
  tzOffsetMin?: number;
  /** Number of minutes already in the cell — used as an info chip in
   *  the expansion header so the user sees the aggregate while
   *  editing per-entry rows. */
  totalMinutes: number;
  onClose: () => void;
}

export function CellExpansion({
  entries,
  project,
  categoryId,
  dayDateStr,
  dayDateLong,
  tzOffsetMin,
  totalMinutes,
  onClose,
}: CellExpansionProps): React.JSX.Element {
  const t = useTranslations("time.cellExpansion");
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the first editable input on open so keyboard users land
  // somewhere useful — primary action is editing the first entry,
  // not closing the expansion.
  useEffect(() => {
    const first =
      containerRef.current?.querySelector<HTMLElement>(
        "input[name='description'], textarea[name='description'], button[data-cell-add]",
      );
    first?.focus();
  }, []);

  const [adding, setAdding] = useState(entries.length === 0);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-accent bg-surface-raised p-4 space-y-3"
      role="region"
      aria-label={t("regionLabel", {
        project: project?.name ?? "—",
        date: dayDateLong,
      })}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold text-content">
            {project?.name ?? "—"}
          </span>
          <span className="text-caption text-content-muted">·</span>
          <span className="text-caption text-content-muted">{dayDateLong}</span>
          <span className="text-caption text-content-muted">·</span>
          <span className="text-caption font-mono text-content-secondary tabular-nums">
            {t("entriesCount", { count: entries.length })}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className={buttonGhostClass}
        >
          <X size={14} />
        </button>
      </header>

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <CellEntryRow
              entry={entry}
              project={project}
              tzOffsetMin={tzOffsetMin}
            />
          </li>
        ))}
      </ul>

      {adding ? (
        <CellAddEntryRow
          project={project}
          categoryId={categoryId}
          dayDateStr={dayDateStr}
          dayDateLong={dayDateLong}
          tzOffsetMin={tzOffsetMin}
          totalMinutes={totalMinutes}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          data-cell-add
          onClick={() => setAdding(true)}
          className={`${buttonGhostClass} text-caption`}
        >
          <Plus size={14} />
          {t("addEntry")}
        </button>
      )}
    </div>
  );
}

function CellEntryRow({
  entry,
  project,
  tzOffsetMin,
}: {
  entry: TimeEntry;
  project: ProjectOption | undefined;
  tzOffsetMin?: number;
}): React.JSX.Element {
  const t = useTranslations("time.cellExpansion");
  const tc = useTranslations("common");

  // Locked entries route through the day-view editor only — the cell
  // expansion can't unlock them, so we render a read-only summary
  // and link out to the invoice. Mirrors the inline-edit-form gate.
  const locked = entry.invoiced && entry.invoice_id != null;

  const update = useFormAction({ action: updateTimeEntryAction });
  const del = useFormAction({ action: deleteTimeEntryAction });

  const linkedTicket =
    entry.linked_ticket_provider && entry.linked_ticket_key
      ? {
          provider: entry.linked_ticket_provider,
          key: entry.linked_ticket_key,
          url: entry.linked_ticket_url,
          title: entry.linked_ticket_title,
        }
      : null;

  if (locked) {
    return (
      <div className="rounded-md border border-edge bg-surface-inset p-3 text-body text-content-muted">
        <p className="font-mono">{entry.linked_ticket_key ?? ""}</p>
        <p className="truncate">{entry.description ?? "—"}</p>
        <p className="mt-1 text-caption">
          {t("editDayView")}{" "}
          <Link
            href="/time-entries?view=day"
            className="text-accent underline hover:no-underline"
          >
            {t("openDayView")} <ExternalLink size={10} className="inline" />
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form
      action={update.handleSubmit}
      className="rounded-md border border-edge bg-surface p-3 space-y-2"
    >
      <input type="hidden" name="id" value={entry.id} />
      {tzOffsetMin !== undefined && (
        <input type="hidden" name="tz_offset_min" value={String(tzOffsetMin)} />
      )}
      {/* The cell expansion never edits start_time / end_time /
          duration — those are owned by the parent cell's aggregate
          input or the day-view full editor. We omit them so the
          server action falls back to the existing row's values. */}

      {update.serverError && (
        <AlertBanner tone="error">{update.serverError}</AlertBanner>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`cell-desc-${entry.id}`}
            className={labelClass}
          >
            {t("fields.description")}
          </label>
          <input
            id={`cell-desc-${entry.id}`}
            name="description"
            defaultValue={entry.description ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <TicketField
            idPrefix={`cell-${entry.id}`}
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
          />
          <button
            type="button"
            onClick={() => {
              const fd = new FormData();
              fd.set("id", entry.id);
              void del.handleSubmit(fd);
            }}
            disabled={del.pending}
            aria-label={t("deleteEntry")}
            className={`${buttonGhostClass} text-error`}
          >
            <Trash2 size={14} />
            {t("delete")}
          </button>
        </div>
      </div>
    </form>
  );
}

function CellAddEntryRow({
  project,
  categoryId,
  dayDateStr,
  dayDateLong,
  tzOffsetMin,
  totalMinutes,
  onDone,
}: {
  project: ProjectOption | undefined;
  categoryId: string | null;
  dayDateStr: string;
  dayDateLong: string;
  tzOffsetMin?: number;
  totalMinutes: number;
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations("time.cellExpansion");
  const tc = useTranslations("common");

  const create = useFormAction({
    action: createTimeEntryAction,
    onSuccess: () => onDone(),
  });

  if (!project) {
    return (
      <p className="text-caption text-content-muted">
        {t("addEntryNoProject")}
      </p>
    );
  }

  // Default duration: if the cell has any minutes already, default
  // to 0 so the user can type in a fresh allocation. If empty, also
  // 0 — the whole point of "+ Add entry" is to capture another row,
  // duration to be filled in.
  const defaultMinutes = 0;
  void totalMinutes; // referenced for future cell-aware behavior

  return (
    <form
      action={create.handleSubmit}
      className="rounded-md border border-accent bg-surface p-3 space-y-2"
    >
      <input type="hidden" name="project_id" value={project.id} />
      {project.team_id && (
        <input type="hidden" name="team_id" value={project.team_id} />
      )}
      {categoryId && (
        <input type="hidden" name="category_id" value={categoryId} />
      )}
      <input type="hidden" name="entry_date" value={dayDateStr} />
      {tzOffsetMin !== undefined && (
        <input type="hidden" name="tz_offset_min" value={String(tzOffsetMin)} />
      )}

      {create.serverError && (
        <AlertBanner tone="error">{create.serverError}</AlertBanner>
      )}

      <p className="text-caption text-content-muted">
        {t("addEntryHeader", { date: dayDateLong })}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label htmlFor="cell-add-desc" className={labelClass}>
            {t("fields.description")}
          </label>
          <input
            id="cell-add-desc"
            name="description"
            autoFocus
            placeholder={t("fields.descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-1">
          <TicketField
            idPrefix="cell-add"
            githubRepo={project.github_repo}
            jiraProjectKey={project.jira_project_key}
          />
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="cell-add-duration" className={labelClass}>
            {t("fields.duration")}
          </label>
          <DurationInput
            name="duration_min"
            defaultMinutes={defaultMinutes}
            ariaLabel={t("fields.duration")}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-body text-content cursor-pointer">
          <input
            type="checkbox"
            name="billable"
            defaultChecked={project.default_billable !== false && !project.is_internal}
            disabled={project.is_internal === true}
            className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring disabled:opacity-50"
          />
          {t("fields.billable")}
        </label>

        <div className="flex items-center gap-2">
          <SubmitButton
            label={t("createEntry")}
            pending={create.pending}
            icon={Plus}
          />
          <button
            type="button"
            onClick={onDone}
            disabled={create.pending}
            className={buttonGhostClass}
          >
            {tc("actions.cancel")}
          </button>
        </div>
      </div>
    </form>
  );
}

