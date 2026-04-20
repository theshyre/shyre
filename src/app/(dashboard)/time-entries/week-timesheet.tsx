"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { formatDurationHMZero } from "@/lib/time/week";
import { addLocalDays, utcToLocalDateStr } from "@/lib/time/tz";
import { DurationInput } from "./duration-input";
import {
  upsertTimesheetCellAction,
  deleteTimeEntryAction,
  restoreTimeEntriesAction,
  startTimerAction,
  stopTimerAction,
} from "./actions";
import {
  buttonSecondaryClass,
  selectClass,
  kbdClass,
} from "@/lib/form-styles";
import { useKeyboardShortcut } from "@theshyre/ui";
import { InlineDeleteButton } from "@/components/InlineDeleteButton";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosaveStatus } from "@/hooks/useAutosaveStatus";
import { useToast } from "@/components/Toast";
import { EntryAuthor } from "@/components/EntryAuthor";
import type { AuthorInfo, CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  /** Local date of Monday of the visible week (YYYY-MM-DD) */
  weekStartStr: string;
  /** User's TZ offset in minutes west of UTC */
  tzOffsetMin: number;
  entries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  defaultTeamId?: string;
  /**
   * Viewer's own user_id. When provided, rows belonging to other authors
   * render read-only and per-author rows are separated. When omitted,
   * every row is treated as the viewer's own (single-user legacy path).
   */
  currentUserId?: string;
}

interface Row {
  projectId: string;
  categoryId: string | null;
  /** Which author these cells belong to */
  userId: string;
  author: AuthorInfo | null;
  /** True when userId matches the viewer — editable cells */
  isOwn: boolean;
  /** When this is a brand-new blank row, no entries exist yet */
  isNew?: boolean;
  /** Per-day duration in minutes, length 7 (Mon..Sun) */
  byDay: number[];
}

/** Dimension the grid collapses rows under. Changes the visual hierarchy
 *  but never the stored (project, category, user) row identity. */
type GroupBy = "member" | "project" | "category";

const GROUP_BY_VALUES: readonly GroupBy[] = ["member", "project", "category"];
const GROUP_BY_STORAGE_KEY = "shyre.weekTimesheet.groupBy";
const GROUP_BY_EVENT = "shyre:weekTimesheet:groupBy";

function parseGroupBy(v: string | null): GroupBy {
  return v === "project" || v === "category" ? v : "member";
}

function subscribeGroupBy(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // `storage` only fires on cross-tab writes; the custom event covers
  // same-tab updates when the user flips the selector here.
  window.addEventListener("storage", cb);
  window.addEventListener(GROUP_BY_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(GROUP_BY_EVENT, cb);
  };
}

function getGroupBySnapshot(): GroupBy {
  if (typeof window === "undefined") return "member";
  return parseGroupBy(window.localStorage.getItem(GROUP_BY_STORAGE_KEY));
}

function getServerGroupBySnapshot(): GroupBy {
  return "member";
}

function writeGroupBy(next: GroupBy): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GROUP_BY_STORAGE_KEY, next);
  window.dispatchEvent(new Event(GROUP_BY_EVENT));
}

interface RowGroup {
  /** Stable key for the group — used for collapse state + React keys */
  key: string;
  label: string;
  /** The author of the group when grouping by member — drives avatar display */
  author: AuthorInfo | null;
  /** Category color swatch when grouping by category */
  categoryColor: string | null;
  /** "You" group sorts to the top when grouping by member */
  isOwnGroup: boolean;
  rows: Row[];
  byDay: number[];
  totalMin: number;
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
  currentUserId,
}: Props): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const tWeek = useTranslations("time.week");
  const tToast = useTranslations("time.toast");
  const save = useAutosaveStatus();
  const toast = useToast();
  // URL state for day-jump links in the column headers — preserves every
  // other filter/search param (org, billable, members, …) so the user
  // doesn't lose their context when they click a day. `useSearchParams`
  // can be null outside a Next router context (e.g. in unit tests), so
  // coerce to an empty string rather than blowing up the whole grid.
  const searchParams = useSearchParams();
  const searchParamsStr = searchParams?.toString() ?? "";
  const router = useRouter();
  const pathname = usePathname();

  // Week nav — shift the `anchor` URL param by ±7 days. The server
  // recomputes the visible week from whatever date `anchor` lands on.
  const navigateToWeek = useCallback(
    (anchorDateStr: string) => {
      const params = new URLSearchParams(searchParamsStr);
      params.set("anchor", anchorDateStr);
      router.push(`${pathname ?? "/time-entries"}?${params.toString()}`);
    },
    [router, pathname, searchParamsStr],
  );
  const prevWeek = useCallback(() => {
    navigateToWeek(addLocalDays(weekStartStr, -7));
  }, [navigateToWeek, weekStartStr]);
  const nextWeek = useCallback(() => {
    navigateToWeek(addLocalDays(weekStartStr, 7));
  }, [navigateToWeek, weekStartStr]);
  const thisWeek = useCallback(() => {
    navigateToWeek(utcToLocalDateStr(new Date(), tzOffsetMin));
  }, [navigateToWeek, tzOffsetMin]);

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
    // (project, category, user) triple — when multiple authors contribute
    // to the same (project, category) cell they get their own rows so the
    // grid is never showing someone-else's minutes in a cell you can edit.
    const rowKey = (
      projectId: string,
      categoryId: string | null,
      userId: string,
    ) => `${projectId}::${categoryId ?? ""}::${userId}`;

    const dayIndexOf = (dateStr: string): number => weekDays.indexOf(dateStr);

    // Aggregate existing entries into rows
    for (const e of entries) {
      const key = rowKey(e.project_id, e.category_id, e.user_id);
      let row = byKey.get(key);
      if (!row) {
        row = {
          projectId: e.project_id,
          categoryId: e.category_id,
          userId: e.user_id,
          author: e.author,
          // When currentUserId isn't threaded (legacy / tests), treat every
          // row as own — mirrors pre-multi-author behavior.
          isOwn: currentUserId === undefined || e.user_id === currentUserId,
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

    // Add any user-added blank rows (always attributed to the current user —
    // the week-timesheet upsert action can only write for auth.uid()).
    const selfId = currentUserId ?? "self";
    for (const extra of extraRows) {
      const key = rowKey(extra.projectId, extra.categoryId, selfId);
      if (!byKey.has(key)) {
        byKey.set(key, {
          projectId: extra.projectId,
          categoryId: extra.categoryId,
          userId: selfId,
          author: null,
          isOwn: true,
          isNew: true,
          byDay: Array.from({ length: DAYS_IN_WEEK }, () => 0),
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      // Own rows first so the editable work is always on top.
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      const pa = projects.find((p) => p.id === a.projectId)?.name ?? "";
      const pb = projects.find((p) => p.id === b.projectId)?.name ?? "";
      const cmp = pa.localeCompare(pb);
      if (cmp !== 0) return cmp;
      const na = a.author?.display_name ?? "";
      const nb = b.author?.display_name ?? "";
      return na.localeCompare(nb);
    });
  }, [entries, projects, extraRows, weekDays, tzOffsetMin, currentUserId]);

  // Row-grouping dimension backed by localStorage via `useSyncExternalStore`
  // — SSR renders the default ("member"), client reconciles to the stored
  // value post-hydration without the setState-in-effect anti-pattern.
  const groupBy = useSyncExternalStore(
    subscribeGroupBy,
    getGroupBySnapshot,
    getServerGroupBySnapshot,
  );
  const setGroupBy = useCallback((next: GroupBy) => writeGroupBy(next), []);

  // Collapse state is two-layered:
  //   - `collapsed`: the literal "these keys are collapsed" set.
  //   - `userOverridden`: which keys the user has explicitly toggled (vs.
  //     keys that fall through to the auto-default rule).
  // Both are keyed by `${groupBy}:${groupKey}` so switching dimensions
  // preserves the user's prior choices in each.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [userOverridden, setUserOverridden] = useState<Set<string>>(new Set());
  const collapseKey = useCallback(
    (key: string) => `${groupBy}:${key}`,
    [groupBy],
  );
  const toggleCollapsed = useCallback(
    (key: string) => {
      const full = `${groupBy}:${key}`;
      setUserOverridden((prev) => {
        const next = new Set(prev);
        next.add(full);
        return next;
      });
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(full)) next.delete(full);
        else next.add(full);
        return next;
      });
    },
    [groupBy],
  );

  const tHeader = useTranslations("time.timesheet.groupHeader");
  const groups = useMemo<RowGroup[]>(() => {
    const byKey = new Map<string, RowGroup>();
    for (const row of rows) {
      let key: string;
      let label: string;
      let author: AuthorInfo | null = null;
      let categoryColor: string | null = null;
      let isOwnGroup = false;

      if (groupBy === "member") {
        key = row.userId;
        author = row.author;
        label = row.isOwn
          ? tHeader("you")
          : (row.author?.display_name ?? tHeader("unknownMember"));
        isOwnGroup = row.isOwn;
      } else if (groupBy === "project") {
        key = row.projectId;
        const project = projects.find((p) => p.id === row.projectId);
        label = project?.name ?? "—";
      } else {
        key = row.categoryId ?? "__no_category__";
        if (row.categoryId) {
          const cat = categories.find((c) => c.id === row.categoryId);
          label = cat?.name ?? tHeader("noCategory");
          categoryColor = cat?.color ?? null;
        } else {
          label = tHeader("noCategory");
        }
      }

      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          label,
          author,
          categoryColor,
          isOwnGroup,
          rows: [],
          byDay: Array.from({ length: DAYS_IN_WEEK }, () => 0),
          totalMin: 0,
        };
        byKey.set(key, g);
      }
      g.rows.push(row);
      for (let i = 0; i < DAYS_IN_WEEK; i++) {
        const m = row.byDay[i] ?? 0;
        g.byDay[i] = (g.byDay[i] ?? 0) + m;
        g.totalMin += m;
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      if (groupBy === "member" && a.isOwnGroup !== b.isOwnGroup) {
        return a.isOwnGroup ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }, [rows, groupBy, projects, categories, tHeader]);

  /**
   * Auto-collapse rule applied when the user hasn't explicitly opened or
   * closed a group. Goal: cut noise on multi-group views without hiding
   * the viewer's own work.
   *   - 1 group → always expanded (nothing to collapse around).
   *   - groupBy = member → only the "You" group expanded; others collapsed.
   *   - other dimensions → first alpha-sorted group expanded; rest collapsed.
   */
  const isDefaultCollapsed = useCallback(
    (group: RowGroup, index: number): boolean => {
      if (groups.length <= 1) return false;
      if (groupBy === "member") return !group.isOwnGroup;
      return index !== 0;
    },
    [groups, groupBy],
  );

  const isCollapsedForGroup = useCallback(
    (group: RowGroup, index: number): boolean => {
      const ck = collapseKey(group.key);
      if (userOverridden.has(ck)) return collapsed.has(ck);
      return isDefaultCollapsed(group, index);
    },
    [collapseKey, userOverridden, collapsed, isDefaultCollapsed],
  );

  const expandAll = useCallback(() => {
    const overrides = new Set(groups.map((g) => collapseKey(g.key)));
    setUserOverridden(overrides);
    setCollapsed(new Set());
  }, [groups, collapseKey]);

  const collapseAll = useCallback(() => {
    const overrides = new Set(groups.map((g) => collapseKey(g.key)));
    setUserOverridden(overrides);
    setCollapsed(overrides);
  }, [groups, collapseKey]);

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

  async function deleteRow(
    projectId: string,
    categoryId: string | null,
    userId: string,
  ): Promise<void> {
    // Capture ids so the undo toast can restore them as a batch.
    // Scope to the row's author so a delete on one member's row doesn't
    // cascade into another member's same-project entries.
    const rowEntries = entries.filter(
      (e) =>
        e.project_id === projectId &&
        e.category_id === categoryId &&
        e.user_id === userId,
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

  // Running entry belonging to the viewer. When a row's (project,
  // category) pair matches this entry, we flip its Play button to Stop
  // so the user can end the timer from the grid without scrolling up to
  // the running-timer card.
  const runningEntry = useMemo(
    () =>
      entries.find(
        (e) =>
          !e.end_time &&
          (currentUserId === undefined || e.user_id === currentUserId),
      ) ?? null,
    [entries, currentUserId],
  );
  // Which weekday column the running entry's start date falls on, -1
  // when there's no running entry (or it's outside this visible week).
  const runningDayIndex = runningEntry
    ? weekDays.indexOf(
        utcToLocalDateStr(runningEntry.start_time, tzOffsetMin),
      )
    : -1;

  // Start a new timer seeded with this row's project + category. Fires
  // the shared `startTimerAction`, which server-side stops whatever the
  // viewer had running before inserting the new entry — so the user can
  // never end up with two concurrently-running timers.
  async function startTimerFromRow(
    projectId: string,
    categoryId: string | null,
  ): Promise<void> {
    const fd = new FormData();
    fd.set("project_id", projectId);
    if (categoryId) fd.set("category_id", categoryId);
    await save.wrap(startTimerAction(fd));
    toast.push({ kind: "success", message: tToast("timerStarted") });
  }

  async function stopRunningTimer(entryId: string): Promise<void> {
    const fd = new FormData();
    fd.set("id", entryId);
    await save.wrap(stopTimerAction(fd));
    toast.push({ kind: "success", message: tToast("timerStopped") });
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
  function focusCell(
    rowIdx: number,
    dayIdx: number,
    dir?: "up" | "down",
  ): void {
    const targetDay = Math.max(0, Math.min(DAYS_IN_WEEK - 1, dayIdx));
    // Walk in the nav direction past any read-only (non-own) rows, which
    // don't register refs. Without this the cursor would get stuck behind
    // another member's row when arrowing up/down.
    let r = Math.max(0, Math.min(rows.length - 1, rowIdx));
    while (r >= 0 && r < rows.length) {
      const el = cellRefs.current.get(`${r}:${targetDay}`);
      if (el) {
        el.focus();
        el.select();
        return;
      }
      if (dir === "up") r -= 1;
      else if (dir === "down") r += 1;
      else return;
    }
  }

  // Add-row trigger state lifted here so the global `N` shortcut can open
  // it from anywhere inside the timesheet frame.
  const [addRowOpen, setAddRowOpen] = useState(false);
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === "e") {
        e.preventDefault();
        expandAll();
        return;
      }
      if (e.shiftKey && k === "c") {
        e.preventDefault();
        collapseAll();
        return;
      }
      if (!e.shiftKey && k === "n") {
        e.preventDefault();
        setAddRowOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [expandAll, collapseAll]);

  // Human-readable label for the currently-visible week:
  // "Apr 20 – 26" when same month, "Apr 27 – May 3" when it straddles.
  const weekRangeLabel = (() => {
    const [sy, sm, sd] = weekStartStr.split("-").map(Number);
    const startDate = new Date(sy!, sm! - 1, sd!);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const startLabel = startDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const endLabel =
      startDate.getMonth() === endDate.getMonth()
        ? endDate.toLocaleDateString(undefined, { day: "numeric" })
        : endDate.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
    return `${startLabel} – ${endLabel}`;
  })();
  const todayStrForNav = utcToLocalDateStr(new Date(), tzOffsetMin);
  const viewingThisWeek = todayStrForNav >= weekStartStr &&
    todayStrForNav <= addLocalDays(weekStartStr, 6);

  // Arrow-key shortcuts to match the DayView's navigation feel (← prev
  // week, → next week). Bailing inside input/textarea/select is handled
  // by the shared hook.
  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: prevWeek });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: nextWeek });

  return (
    <div className="space-y-4">
      {/* Prev / title / next — styled to match DayView's day navigator so
          the two views feel like siblings, not separate widgets. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={prevWeek}
          className={buttonSecondaryClass}
          aria-label={tWeek("prev")}
        >
          <ChevronLeft size={16} />
          <kbd className={kbdClass}>←</kbd>
        </button>
        <h2 className="text-lg font-semibold text-content inline-flex items-center gap-2">
          {viewingThisWeek ? tWeek("thisWeek") : tWeek("weekOf")}
          <span className="font-mono tabular-nums">{weekRangeLabel}</span>
        </h2>
        <button
          type="button"
          onClick={nextWeek}
          className={buttonSecondaryClass}
          aria-label={tWeek("next")}
        >
          <kbd className={kbdClass}>→</kbd>
          <ChevronRight size={16} />
        </button>
        {!viewingThisWeek && (
          <button
            type="button"
            onClick={thisWeek}
            className={buttonSecondaryClass}
          >
            {tWeek("jumpToThisWeek")}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-edge bg-surface-raised overflow-x-auto">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-edge bg-surface-inset">
        <span className="text-label font-semibold uppercase text-content-muted">
          {t("frameTitle")}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-content-muted whitespace-nowrap">
            <span>{t("groupBy.label")}</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className={`${selectClass} py-1 text-caption`}
            >
              {GROUP_BY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`groupBy.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expandAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-2 py-1 text-caption text-content-secondary hover:bg-hover transition-colors whitespace-nowrap"
            >
              <ChevronsDown size={14} />
              {t("expandAll")}
              <kbd className={kbdClass}>⇧E</kbd>
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-2 py-1 text-caption text-content-secondary hover:bg-hover transition-colors whitespace-nowrap"
            >
              <ChevronsUp size={14} />
              {t("collapseAll")}
              <kbd className={kbdClass}>⇧C</kbd>
            </button>
          </div>
          <SaveStatus
            status={save.status}
            lastSavedAt={save.lastSavedAt}
            lastError={save.lastError}
          />
        </div>
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
              {/* First-column label mirrors the dimensions actually shown
                  in the row. The grouped dimension moves into the group
                  header, so the row only carries the remaining one(s). */}
              {groupBy === "project"
                ? t("category")
                : groupBy === "category"
                  ? t("project")
                  : t("categoryProject")}
            </th>
            {weekDays.map((dStr, i) => {
              const [y, m, d] = dStr.split("-").map(Number);
              const dateObj = new Date(y!, m! - 1, d!);
              const isToday = dStr === todayStr;
              const isWeekend = i >= 5;
              // Build a Day-view href for this column: keep every existing
              // URL param and overwrite view/anchor so the viewer lands on
              // that specific day without losing their team/member filter.
              const dayParams = new URLSearchParams(searchParamsStr);
              dayParams.set("view", "day");
              dayParams.set("anchor", dStr);
              const dayHref = `/time-entries?${dayParams.toString()}`;
              const weekday = dateObj.toLocaleDateString(undefined, {
                weekday: "short",
              });
              const fullLabel = dateObj.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              });
              return (
                <th
                  key={dStr}
                  scope="col"
                  className={`p-0 text-center text-label font-semibold uppercase border-b border-edge ${
                    isWeekend ? "bg-surface-inset/60" : ""
                  } ${
                    isToday
                      ? "text-accent border-t-2 border-accent"
                      : "text-content-muted"
                  }`}
                >
                  <Link
                    href={dayHref}
                    aria-label={t("dayJumpAria", { day: fullLabel })}
                    className="block px-2 py-2 hover:bg-hover transition-colors cursor-pointer"
                  >
                    <div>{weekday}</div>
                    <div
                      className={`text-label mt-0.5 ${
                        isToday ? "font-bold text-accent" : "font-normal"
                      }`}
                    >
                      {d}
                    </div>
                  </Link>
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
        {rows.length === 0 && (
          <tbody>
            <tr>
              <td
                colSpan={DAYS_IN_WEEK + 3}
                className="px-3 py-6 text-center text-body text-content-muted"
              >
                {t("empty")}
              </td>
            </tr>
          </tbody>
        )}
        {groups.map((group, i) => {
          const groupCollapsed = isCollapsedForGroup(group, i);
          return (
            <GroupBlock
              key={`${groupBy}:${group.key}`}
              group={group}
              groupBy={groupBy}
              collapsed={groupCollapsed}
              onToggleCollapsed={() => toggleCollapsed(group.key)}
              rowsFlat={rows}
              projects={projects}
              categories={categories}
              weekDays={weekDays}
              todayStr={todayStr}
              setCellRef={setCellRef}
              focusCell={focusCell}
              onCellCommit={submitCell}
              onDelete={deleteRow}
              onDiscardEmpty={removeEmptyRow}
              onStartTimer={startTimerFromRow}
              runningEntry={runningEntry}
              runningDayIndex={runningDayIndex}
              onStopTimer={stopRunningTimer}
            />
          );
        })}
        {/* Add-row lives as the last tbody row so it feels like part of
            the grid, not an appendix. */}
        <tbody>
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
  groupBy,
  onCellCommit,
  onDelete,
  onDiscardEmpty,
  onStartTimer,
  isRunningRow,
  runningStartIso,
  runningDayIndex,
  onStopTimer,
  weekDays,
  todayStr,
  setCellRef,
  onArrowNav,
}: {
  rowIndex: number;
  row: Row;
  projects: ProjectOption[];
  categories: CategoryOption[];
  /** Controls which dimensions are redundant (shown in the group header)
   *  and therefore hidden from the row itself. Also drives author-chip
   *  placement — the chip appears on non-member groupings so the viewer
   *  can always tell whose time they're looking at. */
  groupBy: GroupBy;
  onCellCommit: (dayIndex: number, minutes: number) => void | Promise<void>;
  onDelete: () => void;
  onDiscardEmpty: () => void;
  /** Start a new timer seeded with this row's project + category. */
  onStartTimer: () => void;
  /** True when this exact (project, category, user) has a running
   *  timer — we swap the Play button for Stop and show a pulse. */
  isRunningRow: boolean;
  /** ISO start-time of the running entry on this row, or null. */
  runningStartIso: string | null;
  /** Day-column (0–6) of the running cell, or -1 when there isn't one. */
  runningDayIndex: number;
  onStopTimer: (() => void) | undefined;
  weekDays: string[];
  todayStr: string;
  setCellRef: (row: number, day: number, el: HTMLInputElement | null) => void;
  onArrowNav: (dir: "up" | "down" | "left" | "right", dayIndex: number) => void;
}): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const tc = useTranslations("common.actions");
  const tEntry = useTranslations("time.entry");
  const project = projects.find((p) => p.id === row.projectId);
  const category = row.categoryId
    ? categories.find((c) => c.id === row.categoryId)
    : null;
  const rowTotalActual = row.byDay.reduce((s, n) => s + n, 0);
  const entryCount = row.byDay.filter((m) => m > 0).length;
  const hasSavedData = rowTotalActual > 0 || entryCount > 0;
  // Other members' rows are read-only: the upsert action only touches
  // auth.uid()'s entries, so showing an editable input would be misleading.
  const editable = row.isOwn;

  const hideCategory = groupBy === "category";
  const hideProject = groupBy === "project";
  const showAuthorChip = groupBy !== "member";

  // Live tick for the running cell (minute granularity is enough — the
  // grid's H:MM format doesn't show seconds).
  const [runningNowMs, setRunningNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!runningStartIso) return;
    const id = setInterval(() => setRunningNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [runningStartIso]);
  const liveElapsedMin = runningStartIso
    ? Math.max(
        0,
        Math.floor(
          (runningNowMs - new Date(runningStartIso).getTime()) / 60_000,
        ),
      )
    : 0;

  return (
    <tr
      className={`bg-surface hover:bg-hover border-b border-edge-muted last:border-b-0 transition-colors ${
        !editable ? "opacity-90" : ""
      } ${isRunningRow ? "ring-2 ring-inset ring-success/40" : ""}`}
    >
      <td className="py-2 align-middle">
        <div
          className="border-l-4 pl-3"
          style={{ borderColor: category?.color ?? "var(--edge)" }}
        >
          {!hideCategory && (
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
          )}
          {!hideProject && (
            <div
              className={
                hideCategory
                  ? "text-body-lg font-semibold text-content truncate"
                  : "text-caption text-content-muted truncate mt-0.5"
              }
            >
              <span
                className={
                  hideCategory ? "text-content" : "text-content-secondary"
                }
              >
                {project?.name ?? "—"}
              </span>
              {project?.customers?.name && (
                <span
                  className={hideCategory ? "text-content-muted" : undefined}
                >
                  {" · "}
                  {project.customers.name}
                </span>
              )}
            </div>
          )}
          {showAuthorChip && (
            <div className="mt-1">
              <EntryAuthor author={row.author} size={16} />
            </div>
          )}
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
            {i === runningDayIndex && runningStartIso ? (
              // Live running cell — overrides the editable input for the
              // day the running entry started on. Ticks every minute.
              <div
                className="flex items-center justify-center gap-1.5 w-full px-1.5 py-1 font-mono text-body font-semibold text-success tabular-nums"
                title={tEntry("stopTimerFromRow")}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {formatDurationHMZero(liveElapsedMin)}
              </div>
            ) : editable ? (
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
            ) : (
              <div className="w-full px-1.5 py-1 text-center font-mono text-body tabular-nums text-content-muted">
                {min > 0 ? formatDurationHMZero(min) : <span className="opacity-50">·</span>}
              </div>
            )}
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
        <div className="flex items-center justify-end gap-1">
          {editable &&
            (isRunningRow && onStopTimer ? (
              // This exact row has a running timer — swap in a red Stop
              // button. The live-ticking cell in the running day column
              // carries the "timer is running" signal on its own, so no
              // pulsing dot needed on the button itself.
              <button
                type="button"
                onClick={onStopTimer}
                aria-label={tEntry("stopTimerFromRow")}
                title={tEntry("stopTimerFromRow")}
                className="rounded p-1 text-error hover:bg-error-soft transition-colors"
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              // "Start timer" seeded from this row. Visible on every row
              // the viewer owns — not only rows with saved data, since
              // the user may want to kick off a timer on a just-added
              // blank row too. Server-side auto-stops any other running
              // timer, so a second click never doubles up.
              <button
                type="button"
                onClick={onStartTimer}
                aria-label={tEntry("startTimerFromRow")}
                title={tEntry("startTimerFromRow")}
                className="rounded p-1 text-content-muted hover:bg-hover hover:text-accent transition-colors"
              >
                <Play size={14} />
              </button>
            ))}
          {editable && hasSavedData ? (
            <InlineDeleteRowConfirm
              ariaLabel={t("deleteRow")}
              onConfirm={onDelete}
              summary={tc("deleteCount", { count: entryCount })}
            />
          ) : editable ? (
            // Blank row (user added it, never typed anything). No persisted
            // data — just drop from local state, no confirm needed.
            <InlineDeleteButton
              ariaLabel={t("discardRow")}
              onConfirm={onDiscardEmpty}
            />
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/**
 * One collapsible group in the weekly grid. Renders a header <tr> with the
 * group label + per-day totals + week total, then (when not collapsed) the
 * rows inside the group via `TimesheetRow`.
 */
function GroupBlock({
  group,
  groupBy,
  collapsed,
  onToggleCollapsed,
  rowsFlat,
  projects,
  categories,
  weekDays,
  todayStr,
  setCellRef,
  focusCell,
  onCellCommit,
  onDelete,
  onDiscardEmpty,
  onStartTimer,
  runningEntry,
  runningDayIndex,
  onStopTimer,
}: {
  group: RowGroup;
  groupBy: GroupBy;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Flat row list — used to derive each row's absolute index for
   *  keyboard navigation through the cell grid. */
  rowsFlat: Row[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  weekDays: string[];
  todayStr: string;
  setCellRef: (row: number, day: number, el: HTMLInputElement | null) => void;
  focusCell: (
    rowIdx: number,
    dayIdx: number,
    dir?: "up" | "down",
  ) => void;
  onCellCommit: (
    projectId: string,
    categoryId: string | null,
    dayIndex: number,
    minutes: number,
  ) => void | Promise<void>;
  onDelete: (
    projectId: string,
    categoryId: string | null,
    userId: string,
  ) => void | Promise<void>;
  onDiscardEmpty: (projectId: string, categoryId: string | null) => void;
  onStartTimer: (
    projectId: string,
    categoryId: string | null,
  ) => void | Promise<void>;
  runningEntry: TimeEntry | null;
  /** Day-column (0–6) that `runningEntry` falls on in this week, or -1. */
  runningDayIndex: number;
  onStopTimer: (entryId: string) => void | Promise<void>;
}): React.JSX.Element {
  const tHeader = useTranslations("time.timesheet.groupHeader");

  return (
    <tbody>
      <tr className="bg-surface-inset border-y border-edge">
        <td className="py-1.5 pl-2 align-middle">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? tHeader("expand") : tHeader("collapse")}
            className="flex items-center gap-2 w-full text-left hover:text-accent transition-colors"
          >
            {collapsed ? (
              <ChevronRight size={14} className="shrink-0 text-content-muted" />
            ) : (
              <ChevronDown size={14} className="shrink-0 text-content-muted" />
            )}
            <GroupLabel group={group} groupBy={groupBy} />
            {/* Weight + count, in that order — collapsed groups should
                surface their load first (weight), not just row count. */}
            <span className="text-caption text-content-muted font-mono tabular-nums ml-auto pr-2">
              {formatDurationHMZero(group.totalMin)}
              <span className="font-sans"> · </span>
              {tHeader("rowCount", { count: group.rows.length })}
            </span>
          </button>
        </td>
        {group.byDay.map((min, i) => {
          const dayStr = weekDays[i];
          const isToday = dayStr === todayStr;
          const isWeekend = i >= 5;
          return (
            <td
              key={dayStr ?? i}
              className={`px-2 py-1.5 text-center font-mono text-caption font-semibold tabular-nums ${
                isWeekend ? "bg-surface-inset/80" : ""
              } ${isToday ? "text-accent" : "text-content-secondary"}`}
            >
              {min > 0 ? (
                formatDurationHMZero(min)
              ) : (
                <span className="text-content-muted/50">·</span>
              )}
            </td>
          );
        })}
        <td className="px-2 py-1.5 text-right font-mono text-body-lg font-semibold tabular-nums text-content">
          {formatDurationHMZero(group.totalMin)}
        </td>
        <td className="px-2 py-1.5" />
      </tr>
      {!collapsed &&
        group.rows.map((row) => {
          const rowIdx = rowsFlat.indexOf(row);
          return (
            <TimesheetRow
              key={`${row.projectId}::${row.categoryId ?? ""}::${row.userId}`}
              rowIndex={rowIdx}
              row={row}
              projects={projects}
              categories={categories}
              groupBy={groupBy}
              onCellCommit={(dayIndex, minutes) =>
                onCellCommit(row.projectId, row.categoryId, dayIndex, minutes)
              }
              onDelete={() => {
                void onDelete(row.projectId, row.categoryId, row.userId);
              }}
              onDiscardEmpty={() =>
                onDiscardEmpty(row.projectId, row.categoryId)
              }
              onStartTimer={() => {
                void onStartTimer(row.projectId, row.categoryId);
              }}
              isRunningRow={
                !!runningEntry &&
                runningEntry.project_id === row.projectId &&
                runningEntry.category_id === row.categoryId &&
                runningEntry.user_id === row.userId
              }
              runningStartIso={
                runningEntry &&
                runningEntry.project_id === row.projectId &&
                runningEntry.category_id === row.categoryId &&
                runningEntry.user_id === row.userId
                  ? runningEntry.start_time
                  : null
              }
              runningDayIndex={
                runningEntry &&
                runningEntry.project_id === row.projectId &&
                runningEntry.category_id === row.categoryId &&
                runningEntry.user_id === row.userId
                  ? runningDayIndex
                  : -1
              }
              onStopTimer={
                runningEntry &&
                runningEntry.project_id === row.projectId &&
                runningEntry.category_id === row.categoryId &&
                runningEntry.user_id === row.userId
                  ? () => void onStopTimer(runningEntry.id)
                  : undefined
              }
              weekDays={weekDays}
              todayStr={todayStr}
              setCellRef={setCellRef}
              onArrowNav={(dir, dayIdx) => {
                if (dir === "up") focusCell(rowIdx - 1, dayIdx, "up");
                else if (dir === "down") focusCell(rowIdx + 1, dayIdx, "down");
                else if (dir === "left") focusCell(rowIdx, dayIdx - 1);
                else focusCell(rowIdx, dayIdx + 1);
              }}
            />
          );
        })}
    </tbody>
  );
}

function GroupLabel({
  group,
  groupBy,
}: {
  group: RowGroup;
  groupBy: GroupBy;
}): React.JSX.Element {
  if (groupBy === "member") {
    // Hash user_id into a preset color when no stored avatar_url — keeps
    // every member visually distinct in the grid without asking them to
    // upload a photo. Same hash is used in EntryAuthor so the tile color
    // stays consistent across surfaces.
    const avatarUrl = resolveAvatarUrl(
      group.author?.avatar_url ?? null,
      group.author?.user_id ?? null,
    );
    return (
      <span className="flex items-center gap-2 min-w-0">
        <Avatar
          avatarUrl={avatarUrl}
          displayName={group.label}
          size={20}
        />
        <span className="text-body-lg font-semibold text-content truncate">
          {group.label}
        </span>
      </span>
    );
  }
  if (groupBy === "category") {
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{
            backgroundColor: group.categoryColor ?? "var(--content-muted)",
          }}
        />
        <span className="text-body-lg font-semibold text-content truncate">
          {group.label}
        </span>
      </span>
    );
  }
  return (
    <span className="text-body-lg font-semibold text-content truncate">
      {group.label}
    </span>
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
  // Base set + project-scoped extension set, so the picker surfaces
  // built-in categories + project-specific additions together.
  const availableSetIds = [
    selectedProject?.category_set_id,
    selectedProject?.extension_category_set_id,
  ].filter((id): id is string => !!id);
  const availableCategories = availableSetIds.length
    ? categories.filter((c) => availableSetIds.includes(c.category_set_id))
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
