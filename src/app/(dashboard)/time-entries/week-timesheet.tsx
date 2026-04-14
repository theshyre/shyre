"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import {
  formatDurationHMZero,
  isSameDay,
} from "@/lib/time/week";
import { DurationInput } from "./duration-input";
import {
  upsertTimesheetCellAction,
  deleteTimeEntryAction,
} from "./actions";
import {
  buttonSecondaryClass,
  selectClass,
} from "@/lib/form-styles";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  weekStart: Date;
  entries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  defaultOrgId?: string;
}

interface Row {
  projectId: string;
  categoryId: string | null;
  /** When this is a brand-new blank row, no entries exist yet */
  isNew?: boolean;
  /** Per-day duration in minutes, length 7 (Mon..Sun) */
  byDay: number[];
}

const DAYS_IN_WEEK = 7;

/**
 * Harvest-style weekly timesheet. Each row is a (project, category) combo,
 * columns are Mon..Sun, cells are H:MM duration inputs that upsert an entry
 * on blur.
 */
export function WeekTimesheet({
  weekStart,
  entries,
  projects,
  categories,
  defaultOrgId,
}: Props): React.JSX.Element {
  const t = useTranslations("time.timesheet");

  // Derive rows from existing entries + any user-added blank rows
  const [extraRows, setExtraRows] = useState<
    Array<{ projectId: string; categoryId: string | null; key: string }>
  >([]);

  const rows = useMemo<Row[]>(() => {
    const byKey = new Map<string, Row>();
    const rowKey = (projectId: string, categoryId: string | null) =>
      `${projectId}::${categoryId ?? ""}`;

    // Aggregate existing entries into rows
    for (const e of entries) {
      const key = rowKey(e.project_id, e.category_id);
      let row = byKey.get(key);
      if (!row) {
        row = {
          projectId: e.project_id,
          categoryId: e.category_id,
          byDay: Array.from({ length: DAYS_IN_WEEK }, () => 0),
        };
        byKey.set(key, row);
      }
      const start = new Date(e.start_time);
      const dayIndex = daysBetween(weekStart, start);
      if (dayIndex >= 0 && dayIndex < DAYS_IN_WEEK) {
        row.byDay[dayIndex] = (row.byDay[dayIndex] ?? 0) + (e.duration_min ?? 0);
      }
    }

    // Add any user-added blank rows (for combos not yet in entries)
    for (const extra of extraRows) {
      const key = rowKey(extra.projectId, extra.categoryId);
      if (!byKey.has(key)) {
        byKey.set(key, {
          projectId: extra.projectId,
          categoryId: extra.categoryId,
          isNew: true,
          byDay: Array.from({ length: DAYS_IN_WEEK }, () => 0),
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const pa = projects.find((p) => p.id === a.projectId)?.name ?? "";
      const pb = projects.find((p) => p.id === b.projectId)?.name ?? "";
      return pa.localeCompare(pb);
    });
  }, [entries, projects, extraRows, weekStart]);

  const dailyTotals = useMemo<number[]>(() => {
    const totals = Array.from({ length: DAYS_IN_WEEK }, () => 0);
    for (const row of rows) {
      for (let i = 0; i < DAYS_IN_WEEK; i++) {
        totals[i] = (totals[i] ?? 0) + (row.byDay[i] ?? 0);
      }
    }
    return totals;
  }, [rows]);

  const weekTotal = dailyTotals.reduce((s, n) => s + n, 0);

  const addRow = useCallback(
    (projectId: string, categoryId: string | null) => {
      setExtraRows((prev) => [
        ...prev,
        { projectId, categoryId, key: `${Date.now()}-${Math.random()}` },
      ]);
    },
    [],
  );

  const removeEmptyRow = useCallback((projectId: string, categoryId: string | null) => {
    setExtraRows((prev) =>
      prev.filter(
        (r) => !(r.projectId === projectId && r.categoryId === categoryId),
      ),
    );
  }, []);

  async function submitCell(
    projectId: string,
    categoryId: string | null,
    dayIndex: number,
    minutes: number,
  ): Promise<void> {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayIndex);
    const dateStr = toIsoDate(date);
    const fd = new FormData();
    fd.set("project_id", projectId);
    if (categoryId) fd.set("category_id", categoryId);
    fd.set("entry_date", dateStr);
    fd.set("organization_id", project.organization_id);
    fd.set("duration_min", String(minutes));
    await upsertTimesheetCellAction(fd);
  }

  async function deleteRow(projectId: string, categoryId: string | null): Promise<void> {
    // Find all entries in this row and delete them
    const rowEntries = entries.filter(
      (e) => e.project_id === projectId && e.category_id === categoryId,
    );
    for (const e of rowEntries) {
      const fd = new FormData();
      fd.set("id", e.id);
      await deleteTimeEntryAction(fd);
    }
    removeEmptyRow(projectId, categoryId);
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-raised overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge bg-surface-inset">
            <th className="py-2 pl-4 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted w-[30%]">
              {t("categoryProject")}
            </th>
            {Array.from({ length: DAYS_IN_WEEK }).map((_, i) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + i);
              const isToday = isSameDay(d, new Date());
              return (
                <th
                  key={i}
                  className={`px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${
                    isToday ? "text-accent" : "text-content-muted"
                  }`}
                >
                  <div>
                    {d.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div className="text-[10px] font-normal mt-0.5">
                    {d.getDate()}
                  </div>
                </th>
              );
            })}
            <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("total")}
            </th>
            <th className="px-2 py-2" aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={DAYS_IN_WEEK + 3}
                className="px-3 py-6 text-center text-sm text-content-muted"
              >
                {t("empty")}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <TimesheetRow
              key={`${row.projectId}::${row.categoryId ?? ""}`}
              row={row}
              projects={projects}
              categories={categories}
              onCellCommit={(dayIndex, minutes) =>
                submitCell(row.projectId, row.categoryId, dayIndex, minutes)
              }
              onDelete={() => deleteRow(row.projectId, row.categoryId)}
              weekStart={weekStart}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-edge bg-surface-inset">
            <td className="px-3 py-2 text-right text-xs font-semibold text-content-muted">
              {t("dailyTotals")}
            </td>
            {dailyTotals.map((min, i) => (
              <td
                key={i}
                className="px-2 py-2 text-center font-mono text-xs tabular-nums text-content-secondary"
              >
                {formatDurationHMZero(min)}
              </td>
            ))}
            <td className="px-2 py-2 text-right font-mono text-sm font-semibold tabular-nums text-content">
              {formatDurationHMZero(weekTotal)}
            </td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>

      <AddRowControl
        projects={projects}
        categories={categories}
        existingRows={rows}
        onAdd={addRow}
        defaultOrgId={defaultOrgId}
      />
    </div>
  );
}

function TimesheetRow({
  row,
  projects,
  categories,
  onCellCommit,
  onDelete,
  weekStart,
}: {
  row: Row;
  projects: ProjectOption[];
  categories: CategoryOption[];
  onCellCommit: (dayIndex: number, minutes: number) => void | Promise<void>;
  onDelete: () => void;
  weekStart: Date;
}): React.JSX.Element {
  const project = projects.find((p) => p.id === row.projectId);
  const category = row.categoryId
    ? categories.find((c) => c.id === row.categoryId)
    : null;
  const rowTotalActual = row.byDay.reduce((s, n) => s + n, 0);

  return (
    <tr className="border-b border-edge last:border-0 hover:bg-hover">
      <td className="py-2 align-middle">
        {/* Category as hero — colored left border + name */}
        <div
          className="border-l-4 pl-3"
          style={{ borderColor: category?.color ?? "var(--edge)" }}
        >
          <div className="flex items-center gap-1.5">
            {category ? (
              <>
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: category.color }}
                />
                <span className="text-sm font-semibold text-content truncate">
                  {category.name}
                </span>
              </>
            ) : (
              <span className="text-sm text-content-muted italic truncate">
                —
              </span>
            )}
          </div>
          {/* Project · Client as muted subline */}
          <div className="text-[11px] text-content-muted truncate mt-0.5">
            <span className="text-content-secondary">
              {project?.name ?? "—"}
            </span>
            {project?.clients?.name && (
              <span> · {project.clients.name}</span>
            )}
          </div>
        </div>
      </td>
      {row.byDay.map((min, i) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        const isToday = isSameDay(date, new Date());
        return (
          <td
            key={i}
            className={`px-1 py-1 align-middle ${isToday ? "bg-accent-soft/30" : ""}`}
          >
            <DurationInput
              name={`cell-${row.projectId}-${row.categoryId ?? ""}-${i}`}
              defaultMinutes={min}
              onCommit={(committed) => {
                if (committed !== null && committed !== min) {
                  void onCellCommit(i, committed);
                }
              }}
              className="w-full rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-xs outline-none transition-colors hover:border-content-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
            />
          </td>
        );
      })}
      <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums text-content">
        {rowTotalActual > 0 ? formatDurationHMZero(rowTotalActual) : "—"}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete row"
          className="rounded p-1 text-content-muted hover:bg-hover hover:text-error transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

function AddRowControl({
  projects,
  categories,
  existingRows,
  onAdd,
  defaultOrgId,
}: {
  projects: ProjectOption[];
  categories: CategoryOption[];
  existingRows: Row[];
  onAdd: (projectId: string, categoryId: string | null) => void;
  defaultOrgId?: string;
}): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const availableProjects = defaultOrgId
    ? projects.filter((p) => p.organization_id === defaultOrgId)
    : projects;

  const selectedProject = projects.find((p) => p.id === projectId);
  const availableCategories = selectedProject?.category_set_id
    ? categories.filter((c) => c.category_set_id === selectedProject.category_set_id)
    : [];

  function handleAdd(): void {
    if (!projectId) return;
    const catId = categoryId || null;
    const exists = existingRows.some(
      (r) => r.projectId === projectId && r.categoryId === catId,
    );
    if (!exists) onAdd(projectId, catId);
    setProjectId("");
    setCategoryId("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="border-t border-edge p-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonSecondaryClass}
        >
          <Plus size={14} />
          {t("addRow")}
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-edge p-3 space-y-2 bg-surface-inset">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className={selectClass}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          autoFocus
        >
          <option value="">{t("chooseProject")}</option>
          {availableProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {availableCategories.length > 0 && (
          <select
            className={selectClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t("noCategory")}</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={!projectId}
          className={buttonSecondaryClass}
        >
          <Plus size={14} />
          {t("addRowConfirm")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setProjectId("");
            setCategoryId("");
          }}
          className={buttonSecondaryClass}
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(weekStart: Date, date: Date): number {
  const startDay = new Date(weekStart);
  startDay.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24));
}
