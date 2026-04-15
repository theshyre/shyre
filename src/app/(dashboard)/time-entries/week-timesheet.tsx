"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { formatDurationHMZero } from "@/lib/time/week";
import { addLocalDays, utcToLocalDateStr } from "@/lib/time/tz";
import { DurationInput } from "./duration-input";
import {
  upsertTimesheetCellAction,
  deleteTimeEntryAction,
  restoreTimeEntriesAction,
} from "./actions";
import {
  buttonSecondaryClass,
  selectClass,
  kbdClass,
} from "@/lib/form-styles";
import { InlineDeleteButton } from "@/components/InlineDeleteButton";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosaveStatus } from "@/hooks/useAutosaveStatus";
import { useToast } from "@/components/Toast";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  /** Local date of Monday of the visible week (YYYY-MM-DD) */
  weekStartStr: string;
  /** User's TZ offset in minutes west of UTC */
  tzOffsetMin: number;
  entries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  defaultTeamId?: string;
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
  weekStartStr,
  tzOffsetMin,
  entries,
  projects,
  categories,
  defaultTeamId,
}: Props): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const tToast = useTranslations("time.toast");
  const save = useAutosaveStatus();
  const toast = useToast();

  // Precompute local-date strings for each column (Mon..Sun)
  const weekDays = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, i) => addLocalDays(weekStartStr, i)),
    [weekStartStr],
  );
  const todayStr = utcToLocalDateStr(new Date(), tzOffsetMin);

  // Derive rows from existing entries + any user-added blank rows
  const [extraRows, setExtraRows] = useState<
    Array<{ projectId: string; categoryId: string | null; key: string }>
  >([]);

  const rows = useMemo<Row[]>(() => {
    const byKey = new Map<string, Row>();
    const rowKey = (projectId: string, categoryId: string | null) =>
      `${projectId}::${categoryId ?? ""}`;

    const dayIndexOf = (dateStr: string): number => weekDays.indexOf(dateStr);

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
      const localDate = utcToLocalDateStr(e.start_time, tzOffsetMin);
      const dayIndex = dayIndexOf(localDate);
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
  }, [entries, projects, extraRows, weekDays, tzOffsetMin]);

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
        (r) => !(r.projectId === projectId && r.categoryId === catId(categoryId)),
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
    const dateStr = weekDays[dayIndex];
    if (!dateStr) return;
    const fd = new FormData();
    fd.set("project_id", projectId);
    if (categoryId) fd.set("category_id", categoryId);
    fd.set("entry_date", dateStr);
    fd.set("team_id", project.team_id);
    fd.set("duration_min", String(minutes));
    fd.set("tz_offset_min", String(tzOffsetMin));
    await save.wrap(upsertTimesheetCellAction(fd));
  }

  async function deleteRow(projectId: string, categoryId: string | null): Promise<void> {
    // Capture ids so the undo toast can restore them as a batch.
    const rowEntries = entries.filter(
      (e) => e.project_id === projectId && e.category_id === categoryId,
    );
    const ids = rowEntries.map((e) => e.id);

    await save.wrap(
      (async () => {
        for (const e of rowEntries) {
          const fd = new FormData();
          fd.set("id", e.id);
          await deleteTimeEntryAction(fd);
        }
      })(),
    );
    removeEmptyRow(projectId, categoryId);

    if (ids.length > 0) {
      toast.push({
        kind: "info",
        message:
          ids.length === 1
            ? tToast("entryDeleted")
            : tToast("entriesDeleted", { count: ids.length }),
        actionLabel: tToast("undo"),
        onAction: async () => {
          const fd = new FormData();
          for (const id of ids) fd.append("id", id);
          await save.wrap(restoreTimeEntriesAction(fd));
        },
      });
    }
  }

  // 2D ref map keyed by `${rowIndex}:${dayIndex}` for keyboard navigation
  // between cells. Parent keeps a Map so individual rows don't need to
  // thread a callback through React's DOM attribute surface.
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  function setCellRef(rowIdx: number, dayIdx: number, el: HTMLInputElement | null): void {
    const key = `${rowIdx}:${dayIdx}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }
  function focusCell(rowIdx: number, dayIdx: number): void {
    // Clamp indices to the visible grid.
    const targetRow = Math.max(0, Math.min(rows.length - 1, rowIdx));
    const targetDay = Math.max(0, Math.min(DAYS_IN_WEEK - 1, dayIdx));
    const el = cellRefs.current.get(`${targetRow}:${targetDay}`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  // Add-row trigger state lifted here so the global `N` shortcut can open
  // it from anywhere inside the timesheet frame.
  const [addRowOpen, setAddRowOpen] = useState(false);
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key !== "n" && e.key !== "N") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      )
        return;
      e.preventDefault();
      setAddRowOpen(true);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="rounded-lg border border-edge bg-surface-raised overflow-x-auto">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-edge bg-surface-inset">
        <span className="text-label font-semibold uppercase text-content-muted">
          {t("frameTitle")}
        </span>
        <SaveStatus
          status={save.status}
          lastSavedAt={save.lastSavedAt}
          lastError={save.lastError}
        />
      </div>
      <table className="w-full text-body border-separate border-spacing-0">
        <colgroup>
          <col className="w-[220px]" />
          {weekDays.map((d) => (
            <col key={d} className="w-[72px]" />
          ))}
          <col className="w-[80px]" />
          <col className="w-[32px]" />
        </colgroup>
        <thead>
          <tr className="bg-surface-inset">
            <th
              scope="col"
              className="py-2 pl-4 text-left text-label font-semibold uppercase text-content-muted border-b border-edge"
            >
              {t("categoryProject")}
            </th>
            {weekDays.map((dStr, i) => {
              const [y, m, d] = dStr.split("-").map(Number);
              const dateObj = new Date(y!, m! - 1, d!);
              const isToday = dStr === todayStr;
              const isWeekend = i >= 5;
              return (
                <th
                  key={dStr}
                  scope="col"
                  className={`px-2 py-2 text-center text-label font-semibold uppercase border-b border-edge ${
                    isWeekend ? "bg-surface-inset/60" : ""
                  } ${
                    isToday
                      ? "text-accent border-t-2 border-accent"
                      : "text-content-muted"
                  }`}
                >
                  <div>
                    {dateObj.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div
                    className={`text-label mt-0.5 ${
                      isToday ? "font-bold text-accent" : "font-normal"
                    }`}
                  >
                    {d}
                  </div>
                </th>
              );
            })}
            <th
              scope="col"
              className="px-2 py-2 text-right text-label font-semibold uppercase text-content-muted border-b border-edge"
            >
              {t("total")}
            </th>
            <th
              scope="col"
              className="px-2 py-2 border-b border-edge"
              aria-label={t("columnActions")}
            />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={DAYS_IN_WEEK + 3}
                className="px-3 py-6 text-center text-body text-content-muted"
              >
                {t("empty")}
              </td>
            </tr>
          )}
          {rows.map((row, rowIdx) => (
            <TimesheetRow
              key={`${row.projectId}::${row.categoryId ?? ""}`}
              rowIndex={rowIdx}
              row={row}
              projects={projects}
              categories={categories}
              onCellCommit={(dayIndex, minutes) =>
                submitCell(row.projectId, row.categoryId, dayIndex, minutes)
              }
              onDelete={() => deleteRow(row.projectId, row.categoryId)}
              onDiscardEmpty={() =>
                removeEmptyRow(row.projectId, row.categoryId)
              }
              weekDays={weekDays}
              todayStr={todayStr}
              setCellRef={setCellRef}
              onArrowNav={(dir, dayIdx) => {
                if (dir === "up") focusCell(rowIdx - 1, dayIdx);
                else if (dir === "down") focusCell(rowIdx + 1, dayIdx);
                else if (dir === "left") focusCell(rowIdx, dayIdx - 1);
                else focusCell(rowIdx, dayIdx + 1);
              }}
            />
          ))}
          {/* Add-row lives as the last tbody row so it feels like part of
              the grid, not an appendix. */}
          <tr className="bg-surface-raised">
            <td colSpan={DAYS_IN_WEEK + 3} className="px-3 py-2 border-t border-dashed border-edge-muted">
              <AddRowControl
                open={addRowOpen}
                setOpen={setAddRowOpen}
                projects={projects}
                categories={categories}
                existingRows={rows}
                onAdd={addRow}
                defaultTeamId={defaultTeamId}
              />
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-edge bg-surface-inset">
            <th
              scope="row"
              className="px-3 py-2 text-right text-label font-semibold uppercase text-content-muted"
            >
              {t("dailyTotals")}
            </th>
            {dailyTotals.map((min, i) => (
              <td
                key={i}
                className="px-2 py-2 text-center font-mono text-body-lg font-semibold tabular-nums text-content-secondary"
              >
                {min > 0 ? formatDurationHMZero(min) : <span className="text-content-muted/50">·</span>}
              </td>
            ))}
            <td className="px-2 py-2 text-right font-mono text-title font-semibold tabular-nums text-content">
              {formatDurationHMZero(weekTotal)}
            </td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Identity helper — categoryId in extraRows matches row.categoryId which
 *  is `string | null`. Some callers pass `null`; we want strict equality. */
function catId(v: string | null): string | null {
  return v;
}

function TimesheetRow({
  rowIndex,
  row,
  projects,
  categories,
  onCellCommit,
  onDelete,
  onDiscardEmpty,
  weekDays,
  todayStr,
  setCellRef,
  onArrowNav,
}: {
  rowIndex: number;
  row: Row;
  projects: ProjectOption[];
  categories: CategoryOption[];
  onCellCommit: (dayIndex: number, minutes: number) => void | Promise<void>;
  onDelete: () => void;
  onDiscardEmpty: () => void;
  weekDays: string[];
  todayStr: string;
  setCellRef: (row: number, day: number, el: HTMLInputElement | null) => void;
  onArrowNav: (dir: "up" | "down" | "left" | "right", dayIndex: number) => void;
}): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const tc = useTranslations("common.actions");
  const project = projects.find((p) => p.id === row.projectId);
  const category = row.categoryId
    ? categories.find((c) => c.id === row.categoryId)
    : null;
  const rowTotalActual = row.byDay.reduce((s, n) => s + n, 0);
  const entryCount = row.byDay.filter((m) => m > 0).length;
  const hasSavedData = rowTotalActual > 0 || entryCount > 0;

  return (
    <tr className="hover:ring-1 hover:ring-inset hover:ring-edge-muted odd:bg-surface-raised even:bg-surface">
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
                <span className="text-body-lg font-semibold text-content truncate">
                  {category.name}
                </span>
              </>
            ) : (
              <span className="text-body-lg text-content-muted italic truncate">
                —
              </span>
            )}
          </div>
          {/* Project · Client as muted subline */}
          <div className="text-caption text-content-muted truncate mt-0.5">
            <span className="text-content-secondary">
              {project?.name ?? "—"}
            </span>
            {project?.customers?.name && (
              <span> · {project.customers.name}</span>
            )}
          </div>
        </div>
      </td>
      {row.byDay.map((min, i) => {
        const dayStr = weekDays[i];
        const isToday = dayStr === todayStr;
        const isWeekend = i >= 5;
        return (
          <td
            key={dayStr ?? i}
            className={`px-1 py-1 align-middle ${
              isWeekend ? "bg-surface-inset/40" : ""
            } ${isToday ? "border-l-2 border-accent/40" : ""}`}
          >
            <DurationInput
              ref={(el) => setCellRef(rowIndex, i, el)}
              name={`cell-${row.projectId}-${row.categoryId ?? ""}-${i}`}
              defaultMinutes={min}
              onCommit={(committed) => {
                if (committed !== null && committed !== min) {
                  void onCellCommit(i, committed);
                }
              }}
              onArrowNav={(dir) => onArrowNav(dir, i)}
              className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-body outline-none transition-colors hover:border-edge-muted focus:border-focus-ring focus:bg-surface-raised focus:ring-2 focus:ring-focus-ring/30"
            />
          </td>
        );
      })}
      <td className="px-2 py-2 text-right font-mono text-body-lg font-semibold tabular-nums text-content">
        {rowTotalActual > 0 ? (
          formatDurationHMZero(rowTotalActual)
        ) : (
          <span className="text-content-muted/60">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {hasSavedData ? (
          <InlineDeleteRowConfirm
            ariaLabel={t("deleteRow")}
            onConfirm={onDelete}
            summary={tc("deleteCount", { count: entryCount })}
          />
        ) : (
          // Blank row (user added it, never typed anything). No persisted
          // data — just drop from local state, no confirm needed.
          <InlineDeleteButton
            ariaLabel={t("discardRow")}
            onConfirm={onDiscardEmpty}
          />
        )}
      </td>
    </tr>
  );
}

function AddRowControl({
  open,
  setOpen,
  projects,
  categories,
  existingRows,
  onAdd,
  defaultTeamId,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  projects: ProjectOption[];
  categories: CategoryOption[];
  existingRows: Row[];
  onAdd: (projectId: string, categoryId: string | null) => void;
  defaultTeamId?: string;
}): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const availableProjects = defaultTeamId
    ? projects.filter((p) => p.team_id === defaultTeamId)
    : projects;

  const selectedProject = projects.find((p) => p.id === projectId);
  const availableCategories = selectedProject?.category_set_id
    ? categories.filter((c) => c.category_set_id === selectedProject.category_set_id)
    : [];

  function handleAdd(): void {
    if (!projectId) return;
    const catIdValue = categoryId || null;
    const exists = existingRows.some(
      (r) => r.projectId === projectId && r.categoryId === catIdValue,
    );
    if (!exists) onAdd(projectId, catIdValue);
    setProjectId("");
    setCategoryId("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-body-lg text-content-muted hover:text-content transition-colors"
      >
        <Plus size={14} />
        {t("addRow")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <div className="space-y-2">
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
