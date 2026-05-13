"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  ChevronsDown,
  ChevronsUp,
  Lock,
  Pin,
  Play,
  Plus,
  Square,
  Users,
  Link as LinkIcon,
  ExternalLink,
} from "lucide-react";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import {
  AddEntryRow,
  EntryEditRow,
  EntrySummaryRow,
  flattenEntriesByDay,
  shouldAutoExpand,
} from "./week-entry-row";
import { formatDurationHMZero } from "@/lib/time/week";
import { notifyTimerChanged } from "@/lib/timer-events";
import { localDayBoundsIso } from "@/lib/local-day-bounds";
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
  pinRowAction,
  unpinRowAction,
  setTeamDefaultRowAction,
  unsetTeamDefaultRowAction,
} from "./pinned-rows-actions";
import { isTeamAdmin } from "@/lib/team-roles";
import {
  buttonGhostClass,
  buttonSecondaryClass,
  selectClass,
  kbdClass,
} from "@/lib/form-styles";
import { useKeyboardShortcut } from "@theshyre/ui";
import { InlineDeleteButton } from "@/components/InlineDeleteButton";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { SaveStatus } from "@/components/SaveStatus";
import { Tooltip } from "@/components/Tooltip";
import { useAutosaveStatus } from "@/hooks/useAutosaveStatus";
import { useToast } from "@/components/Toast";
import { EntryAuthor } from "@/components/EntryAuthor";
import { CustomerChip, customerRailColor } from "@/components/CustomerChip";
import { JumpToDate } from "./jump-to-date";
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
  /** Active rows for the viewer on this team — union of recent
   *  entries, personal pins, and team defaults from the
   *  stint_active_rows RPC. Used to populate empty rows for
   *  (project, category) combos that don't have entries this week
   *  but are still "live" via pin or recent activity. Each row's
   *  `source` string identifies the bucket(s) it came from. */
  activeRows?: ReadonlyArray<{
    projectId: string;
    categoryId: string | null;
    source: string;
  }>;
  /** Viewer's role on the active-rows team. When owner / admin, the
   *  per-row team-default button renders alongside the personal pin
   *  button. Members see only their personal pin and the read-only
   *  team-default chip on rows other admins have already defaulted. */
  currentTeamRole?: "owner" | "admin" | "member";
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
  /** True when the viewer has personally pinned this row. Drives the
   *  Pin button's filled-vs-outline rendering. */
  isPinned?: boolean;
  /** True when this row is a team-default (every member sees it).
   *  Renders a small "Team" chip; admins can unset, members can't. */
  isTeamDefault?: boolean;
  /** Per-day duration in minutes, length 7 (Mon..Sun) */
  byDay: number[];
  /** Per-day "any entry in this cell is invoiced" flag, length 7.
   *  When true, the cell renders read-only with a lock indicator —
   *  the DB trigger refuses UPDATE/DELETE on those rows, and the
   *  upsert action also refuses early with a friendlier message. */
  invoicedByDay: boolean[];
  /** Per-day lookup of an invoice id for the lock chip's link
   *  target. Same length / index as byDay; null when the day is
   *  not locked. */
  invoiceIdByDay: (string | null)[];
  /** Per-day list of underlying entries — drives the cell-expansion
   *  editor (Phase 2). Aggregating entries into byDay loses the
   *  per-entry description / ticket attribution; this preserves it
   *  so the expansion can render real editable entry rows. */
  entriesByDay: TimeEntry[][];
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
  activeRows = [],
  currentTeamRole = "member",
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
  // Week navigation uses router.push under a React transition so
  // `isNavigating` flips true for the duration of the next server
  // render. Without the transition, clicking prev/next just sat there
  // with no feedback — the TopProgressBar global bar fires on Link
  // clicks, not on programmatic router.push.
  const [isNavigating, startNavTransition] = useTransition();
  const navigateToWeek = useCallback(
    (anchorDateStr: string) => {
      const params = new URLSearchParams(searchParamsStr);
      params.set("anchor", anchorDateStr);
      startNavTransition(() => {
        router.push(`${pathname ?? "/time-entries"}?${params.toString()}`);
      });
    },
    [router, pathname, searchParamsStr],
  );
  const prevWeek = useCallback(() => {
    navigateToWeek(addLocalDays(weekStartStr, -7));
  }, [navigateToWeek, weekStartStr]);
  const nextWeek = useCallback(() => {
    navigateToWeek(addLocalDays(weekStartStr, 7));
  }, [navigateToWeek, weekStartStr]);
  // `thisWeek` was a separate "Jump to this week" button before
  // the JumpToDate control absorbed that role via the Today
  // pill it renders adjacent to the trigger. Kept here would be
  // dead code; removed entirely.

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
          invoicedByDay: Array.from({ length: DAYS_IN_WEEK }, () => false),
          invoiceIdByDay: Array.from(
            { length: DAYS_IN_WEEK },
            () => null as string | null,
          ),
          entriesByDay: Array.from(
            { length: DAYS_IN_WEEK },
            () => [] as TimeEntry[],
          ),
        };
        byKey.set(key, row);
      }
      const localDate = utcToLocalDateStr(e.start_time, tzOffsetMin);
      const dayIndex = dayIndexOf(localDate);
      if (dayIndex >= 0 && dayIndex < DAYS_IN_WEEK) {
        row.byDay[dayIndex] = (row.byDay[dayIndex] ?? 0) + (e.duration_min ?? 0);
        row.entriesByDay[dayIndex]!.push(e);
        if (e.invoiced && e.invoice_id) {
          row.invoicedByDay[dayIndex] = true;
          // First invoice id wins — typical cell has at most one
          // entry, but if Harvest re-attached a duplicate we'd
          // surface the first invoice for the lock-chip link.
          if (row.invoiceIdByDay[dayIndex] === null) {
            row.invoiceIdByDay[dayIndex] = e.invoice_id;
          }
        }
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
          invoicedByDay: Array.from({ length: DAYS_IN_WEEK }, () => false),
          invoiceIdByDay: Array.from(
            { length: DAYS_IN_WEEK },
            () => null as string | null,
          ),
          entriesByDay: Array.from(
            { length: DAYS_IN_WEEK },
            () => [] as TimeEntry[],
          ),
        });
      }
    }

    // Fold in active rows from the stint_active_rows RPC — (project,
    // category) combos the viewer has pinned, that have recent
    // entries outside the visible week, or that the team has set as
    // defaults. These render as empty rows the user can immediately
    // log into without going through "+ Add row" first. Always
    // attributed to the viewer.
    for (const activeRow of activeRows) {
      const key = rowKey(activeRow.projectId, activeRow.categoryId, selfId);
      const sources = activeRow.source.split(",");
      const isPinned = sources.includes("pinned");
      const isTeamDefault = sources.includes("team_default");
      const existing = byKey.get(key);
      if (existing) {
        // Row already has entries this week — just stamp the flags
        // so the pin button + team chip render correctly.
        existing.isPinned = isPinned;
        existing.isTeamDefault = isTeamDefault;
        continue;
      }
      byKey.set(key, {
        projectId: activeRow.projectId,
        categoryId: activeRow.categoryId,
        userId: selfId,
        author: null,
        isOwn: true,
        isPinned,
        isTeamDefault,
        byDay: Array.from({ length: DAYS_IN_WEEK }, () => 0),
        invoicedByDay: Array.from({ length: DAYS_IN_WEEK }, () => false),
        invoiceIdByDay: Array.from(
          { length: DAYS_IN_WEEK },
          () => null as string | null,
        ),
        entriesByDay: Array.from(
          { length: DAYS_IN_WEEK },
          () => [] as TimeEntry[],
        ),
      });
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
  }, [entries, projects, extraRows, weekDays, tzOffsetMin, currentUserId, activeRows]);

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

  const dailyTotalsBase = useMemo<number[]>(() => {
    const totals = Array.from({ length: DAYS_IN_WEEK }, () => 0);
    for (const row of rows) {
      for (let i = 0; i < DAYS_IN_WEEK; i++) {
        totals[i] = (totals[i] ?? 0) + (row.byDay[i] ?? 0);
      }
    }
    return totals;
  }, [rows]);

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
    // runSafeAction returns { success, error } — it doesn't throw on
    // server-side failures (it logs + returns a user-safe shape so
    // useFormAction can render the message). useAutosaveStatus.wrap
    // only flips to "error" when the wrapped promise rejects, so
    // without an explicit throw inside the wrap, the cell would
    // silently render "Saved" on a failed write (the user reported
    // exactly this: editing a locked cell silently shows green).
    //
    // Throw inside the wrapped promise so save.wrap sees the
    // rejection, then catch the re-throw at this boundary — status
    // is already updated to "error" with the message, and not
    // catching here would surface as an unhandled rejection.
    try {
      await save.wrap(
        (async () => {
          const result = (await upsertTimesheetCellAction(fd)) as unknown as
            | { success: boolean; error?: { message: string } }
            | void;
          if (result && (result as { success: boolean }).success === false) {
            throw new Error(
              (result as { error?: { message: string } }).error?.message ??
                "Save failed. Please try again.",
            );
          }
        })(),
      );
    } catch {
      // save.wrap already flipped status → "error" with the message.
    }
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

  // Parent-level tick so the daily totals + week total fold in the
  // running entry's live elapsed minutes. Without this the running
  // row's day cell shows e.g. "·2:49" but the footer's DAILY TOTALS
  // and the masthead's week total stay frozen at last-committed
  // minutes — visible bug in screenshots dated 2026-05-11. The tick
  // fires every second so minute rollovers align with the row's
  // per-second tick; the rounded-minute value only changes once a
  // minute, so downstream re-renders are cheap.
  const [parentTickMs, setParentTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!runningEntry?.start_time) return;
    const id = setInterval(() => setParentTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runningEntry?.start_time]);
  const parentLiveElapsedMin = runningEntry?.start_time
    ? Math.max(
        0,
        Math.floor(
          (parentTickMs - new Date(runningEntry.start_time).getTime()) /
            60_000,
        ),
      )
    : 0;

  // Daily totals visible in the footer fold in the running entry's
  // live minutes on the day the running entry started.
  const dailyTotals =
    runningDayIndex >= 0 && parentLiveElapsedMin > 0
      ? dailyTotalsBase.map((t, i) =>
          i === runningDayIndex ? t + parentLiveElapsedMin : t,
        )
      : dailyTotalsBase;

  const weekTotal = dailyTotals.reduce((s, n) => s + n, 0);

  // Start a timer for a row. Two paths:
  //   - resumeEntryId provided → resume that entry (description,
  //     ticket attachment, category all preserved). Used when the row
  //     has at least one existing entry — picking the most-recent one
  //     is the right default since the row's Play button is asking
  //     "start the work this row represents," not "create a brand new
  //     blank entry just like this row."
  //   - resumeEntryId null → seed a new entry from (project, category)
  //     only. Used for brand-new rows (typed-add via "+ Add row") that
  //     have no entries yet.
  // Both paths route through startTimerAction which stops the running
  // timer first so the viewer never ends up with two concurrent timers.
  async function startTimerFromRow(
    projectId: string,
    categoryId: string | null,
    resumeEntryId: string | null,
  ): Promise<void> {
    const fd = new FormData();
    if (resumeEntryId) {
      fd.set("resume_entry_id", resumeEntryId);
    } else {
      fd.set("project_id", projectId);
      if (categoryId) fd.set("category_id", categoryId);
    }
    const [dayStart, dayEnd] = localDayBoundsIso();
    fd.set("day_start_iso", dayStart);
    fd.set("day_end_iso", dayEnd);
    await save.wrap(startTimerAction(fd));
    notifyTimerChanged();
    toast.push({ kind: "success", message: tToast("timerStarted") });
  }

  async function stopRunningTimer(entryId: string): Promise<void> {
    const fd = new FormData();
    fd.set("id", entryId);
    await save.wrap(stopTimerAction(fd));
    notifyTimerChanged();
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

  // Week range label + viewingThisWeek flag used to be computed here
  // for the inline header. The JumpToDate control now owns the label
  // formatting + the Today-pill behavior, so both are no longer
  // needed locally.

  // Arrow-key shortcuts to match the DayView's navigation feel (← prev
  // week, → next week). Bailing inside input/textarea/select is handled
  // by the shared hook.
  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: prevWeek });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: nextWeek });

  // Count rows the user is seeing this week ONLY because of pin /
  // team-default / recent-activity inference (no entries this week
  // yet). Drives the first-render-of-new-week banner — when the user
  // opens a fresh Monday view, telegraph "your rows are still here,
  // pin the ones you want to keep" instead of letting the silence
  // imply "you forgot to set up the week."
  const carriedRowsCount = rows.filter(
    (r) =>
      r.isOwn &&
      r.byDay.every((m) => m === 0) &&
      (r.isPinned || r.isTeamDefault || activeRows.some(
        (a) => a.projectId === r.projectId && a.categoryId === r.categoryId,
      )),
  ).length;

  return (
    <div className="space-y-4">
      {carriedRowsCount > 0 && (
        <NewWeekRolloverBanner
          weekStartStr={weekStartStr}
          carriedRowsCount={carriedRowsCount}
        />
      )}
      <div className="rounded-lg border border-edge bg-surface-raised overflow-x-auto">
      {/* Frame top bar — week nav lives here instead of a separate row
          above the frame, and the redundant "WEEKLY TIMESHEET" label
          is gone. The weekday columns + the Day/Week toggle on the
          page header already make the surface self-evident. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-edge bg-surface-inset">
        <div className="flex items-center gap-2">
          <JumpToDate
            view="week"
            anchorStr={weekStartStr}
            todayStr={utcToLocalDateStr(new Date(), tzOffsetMin)}
            tzOffsetMin={tzOffsetMin}
            onPrev={prevWeek}
            onNext={nextWeek}
            prevLabel={tWeek("prev")}
            nextLabel={tWeek("next")}
          />
          {isNavigating ? (
            <span className="text-caption text-content-muted inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              {tWeek("loading")}
            </span>
          ) : null}
        </div>
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
              className={buttonSecondaryClass}
            >
              <ChevronsDown size={16} />
              {t("expandAll")}
              <kbd className={kbdClass}>⇧E</kbd>
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className={buttonSecondaryClass}
            >
              <ChevronsUp size={16} />
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
      {/* table-fixed so the <colgroup> widths are the authoritative
          source of column sizing. Without it, the browser's auto
          layout re-distributes width between columns depending on
          the content of currently-visible rows — collapsing a group
          removed the wide detail-row content and the day columns
          widened to compensate, visibly "shifting" the whole table.
          Fixed layout keeps MON through SUN anchored at 72px each
          regardless of expand/collapse state. */}
      <table
        className="w-full table-fixed text-body border-separate border-spacing-0"
        aria-label={tWeek("ariaWeekTable", {
          start: weekDays[0] ?? weekStartStr,
          end: weekDays[6] ?? weekStartStr,
        })}
      >
        {/* Visually-hidden caption gives screen-reader users the week
            range up front — without it AT users had no way to know
            which week they're in without scrolling to find the
            jump-to-date trigger. */}
        <caption className="sr-only">
          {tWeek("ariaWeekTable", {
            start: weekDays[0] ?? weekStartStr,
            end: weekDays[6] ?? weekStartStr,
          })}
        </caption>
        <colgroup>
          <col className="w-[220px]" />
          {weekDays.map((d) => (
            <col key={d} className="w-[72px]" />
          ))}
          <col className="w-[80px]" />
          {/* Actions col fits Play + InlineDelete side-by-side. The
              previous 32px was narrower than a single button — both
              icons rendered with `justify-end`, but the cell was so
              narrow that their bounding box overflowed leftward into
              the TOTAL column, crowding the totals digits. 72px
              accommodates two 24px buttons + an inter-button gap +
              the cell's px-2 horizontal padding with breathing
              room. */}
          <col className="w-[72px]" />
        </colgroup>
        <thead>
          {/* No border-b on thead cells — the group header below
              already carries `border-y border-edge`, and with
              border-separate the two stack into a doubled 2px line.
              Pick one boundary; the group header's wins. */}
          <tr className="bg-surface-inset">
            <th
              scope="col"
              className="py-2 pl-4 text-left text-body font-semibold uppercase text-content-muted"
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
                  // text-right so the weekday + date sit on the same
                  // visual rail as the numeric cells in the column
                  // below — centered headers over right-aligned cells
                  // read as two different columns stacked together,
                  // even though they're the same.
                  className={`p-0 text-right text-body font-semibold uppercase text-content-muted ${
                    isToday
                      ? "bg-accent-soft/40"
                      : isWeekend
                        ? "bg-surface-inset/60"
                        : ""
                  }`}
                >
                  <Link
                    href={dayHref}
                    aria-label={
                      isToday
                        ? t("dayJumpAriaToday", { day: fullLabel })
                        : t("dayJumpAria", { day: fullLabel })
                    }
                    className="block px-2 py-2 hover:bg-hover transition-colors cursor-pointer"
                  >
                    <div>
                      {weekday}
                      {/* Visually-hidden marker so users without
                          color perception still know which column is
                          today — the bg-accent-soft tint is the only
                          other current-day signal otherwise. */}
                      {isToday && <span className="sr-only"> (today)</span>}
                    </div>
                    <div
                      className={`text-body mt-0.5 ${
                        isToday ? "font-bold text-content" : "font-normal"
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
              className="px-2 py-2 text-right text-body font-semibold uppercase text-content-muted"
            >
              {t("total")}
            </th>
            <th
              scope="col"
              className="px-2 py-2"
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
              tzOffsetMin={tzOffsetMin}
              setCellRef={setCellRef}
              focusCell={focusCell}
              onCellCommit={submitCell}
              onDelete={deleteRow}
              onDiscardEmpty={removeEmptyRow}
              onStartTimer={startTimerFromRow}
              runningEntry={runningEntry}
              runningDayIndex={runningDayIndex}
              onStopTimer={stopRunningTimer}
              currentTeamRole={currentTeamRole}
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
              className="px-3 py-2 text-right text-body font-semibold uppercase text-content-muted"
            >
              {t("dailyTotals")}
            </th>
            {dailyTotals.map((min, i) => {
              const dayStr = weekDays[i];
              const isToday = dayStr === todayStr;
              return (
                <td
                  key={i}
                  // Day cells in the totals row use text-content
                  // (same as the week-total cell) — totals row is
                  // the answer; all numbers in it deserve equal
                  // weight. Today cell gets the unified accent band
                  // continuing through the footer.
                  className={`px-2 py-2 text-right font-mono text-title font-semibold tabular-nums text-content ${
                    isToday ? "bg-accent-soft/40" : ""
                  }`}
                >
                  {min > 0 ? formatDurationHMZero(min) : <span className="text-content-muted">·</span>}
                </td>
              );
            })}
            <td className="px-2 py-2 text-right font-mono text-title font-bold tabular-nums text-content">
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
  hideCustomer = false,
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
  tzOffsetMin,
  setCellRef,
  onArrowNav,
  currentTeamRole = "member",
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
  /** True when this row sits beneath a customer sub-group header
   *  (Member groupings, multi-row customer runs). The chip + name
   *  live in the sub-header so we suppress the per-row customer
   *  block. False for inline single-row customers (no sub-header)
   *  and for non-Member groupings. */
  hideCustomer?: boolean;
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
  /** TZ offset (minutes) so the cell-expansion editor can pass it
   *  through to the create / update server actions for the cell's
   *  date math. */
  tzOffsetMin: number | undefined;
  setCellRef: (row: number, day: number, el: HTMLInputElement | null) => void;
  onArrowNav: (dir: "up" | "down" | "left" | "right", dayIndex: number) => void;
  /** Viewer's role on the active-rows team. Admin / owner sees the
   *  per-row team-default button alongside their personal pin. */
  currentTeamRole?: "owner" | "admin" | "member";
}): React.JSX.Element {
  const t = useTranslations("time.timesheet");
  const tc = useTranslations("common.actions");
  const tEntry = useTranslations("time.entry");
  const tLock = useTranslations("time.lock");
  const tCell = useTranslations("time.cellExpansion");
  const project = projects.find((p) => p.id === row.projectId);
  const category = row.categoryId
    ? categories.find((c) => c.id === row.categoryId)
    : null;
  // Pre-formatted long-form "today" string for screen-reader-friendly
  // aria-labels on the row Play / Stop buttons. Formatted from
  // todayStr (YYYY-MM-DD) using the user's locale so e.g. "Tuesday,
  // May 5, 2026". Falls back to the raw string when parsing fails
  // (defensive — shouldn't happen given week-list construction).
  const todayLong = (() => {
    const parts = todayStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      return todayStr;
    }
    const [y, m, d] = parts;
    return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  })();
  const rowTotalSaved = row.byDay.reduce((s, n) => s + n, 0);
  const entryCount = row.byDay.filter((m) => m > 0).length;
  const hasSavedData = rowTotalSaved > 0 || entryCount > 0;
  // Other members' rows are read-only: the upsert action only touches
  // auth.uid()'s entries, so showing an editable input would be misleading.
  const editable = row.isOwn;

  // Row-level entry expansion — when true, the row's per-entry
  // sub-rows are visible after the parent <tr>. Smart-defaults to
  // true on first render when any visible day has more than one
  // entry (otherwise the click-to-expand is invisible to the user
  // who hit the multi-entry case). User toggles override the
  // default until the row's data shape changes.
  const [expanded, setExpanded] = useState<boolean>(() =>
    shouldAutoExpand(row.entriesByDay),
  );
  // Currently-edited entry id within this row, or null when no
  // entry is in inline-edit mode. Mutually exclusive across the
  // row's entries (only one edit drawer open at a time).
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  // Whether the row's "+ Add entry" form is currently open.
  const [addingEntry, setAddingEntry] = useState<boolean>(false);

  const hideCategory = groupBy === "category";
  const hideProject = groupBy === "project";
  const showAuthorChip = groupBy !== "member";

  // Customer-color rail on the row's leading cell. Visible only under
  // Member grouping — Project grouping has one customer per group and
  // Category grouping shatters customers across groups, so a rail
  // there would imply a relationship that isn't real. The rail uses
  // the same AVATAR_PRESETS hash as the CustomerChip so a customer's
  // chip and any adjacent rail render in lock-step; internal projects
  // and missing-customer rows fall back to a neutral edge color so
  // the visual continuity still exists without hashing a phantom id.
  const customerId = project?.customers?.id ?? null;
  const customerRail = groupBy === "member"
    ? (customerRailColor(customerId) ?? "var(--edge)")
    : null;

  // Live tick for the running cell. Tick every second even though the
  // display is H:MM granularity — a 60s interval that fires on an
  // arbitrary mount-time offset leaves the cell showing a stale
  // minute (e.g. "0:09" while the banner reads "0:10:04"). Ticking
  // every second aligns the cell's minute rollover with the banner's.
  // Cheap for a handful of running cells.
  const [runningNowMs, setRunningNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!runningStartIso) return;
    const id = setInterval(() => setRunningNowMs(Date.now()), 1000);
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
    <>
    <tr
      className={`bg-surface hover:bg-hover border-b border-edge-muted last:border-b-0 transition-colors ${
        isRunningRow ? "ring-2 ring-inset ring-success/40" : ""
      }`}
    >
      <td
        className={`py-2 align-middle ${customerRail ? "border-l-4 pl-1.5" : ""}`}
        style={customerRail ? { borderLeftColor: customerRail } : undefined}
      >
        <div className="flex items-start gap-1">
          {/* Row-level expansion chevron. Visible whenever the row
              has at least one entry — clicking toggles the per-entry
              <tr> sub-rows below the parent row. Auto-defaults to
              expanded on first paint when the row has any day with
              more than one entry (smart-default rule from the design
              review). One chevron per row replaces the previous
              per-day chevrons. */}
          {row.entriesByDay.some((d) => d.length > 0) ? (
            <Tooltip
              label={
                expanded
                  ? tCell("collapseTooltip")
                  : tCell("expandTooltip")
              }
            >
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-controls={`row-entries-${rowIndex}`}
                aria-label={tCell("expandAriaRow", {
                  count: row.entriesByDay.reduce(
                    (s, d) => s + d.length,
                    0,
                  ),
                })}
                className="mt-1 inline-flex shrink-0 items-center rounded p-0.5 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </button>
            </Tooltip>
          ) : (
            // Empty placeholder so the headline aligns vertically
            // with rows that DO have a chevron — without it the
            // text rows shift left by 18px.
            <span className="mt-1 inline-block w-[22px]" aria-hidden="true" />
          )}
        {/* Pin affordance. Visible only on the viewer's own rows
            (row.isOwn) — pinning another member's row would have no
            effect since the action is auth.uid-scoped. Filled pin =
            personally pinned by the viewer; outline pin = available
            to pin. Team-default rows render the same chevron / pin
            controls but with an additional "Team" chip on the
            customer line so members know they didn't pin it
            themselves but can't make it disappear either.
            Tooltip carries the explicit verb. */}
        {row.isOwn && project && (
          <PinRowButton
            teamId={project.team_id}
            projectId={row.projectId}
            categoryId={row.categoryId}
            isPinned={row.isPinned ?? false}
          />
        )}
        {project && isTeamAdmin(currentTeamRole) && (
          <TeamDefaultRowButton
            teamId={project.team_id}
            projectId={row.projectId}
            categoryId={row.categoryId}
            isTeamDefault={row.isTeamDefault ?? false}
          />
        )}
        {/* Colored rail repeats the category color from the row's own
            category cell. When grouping by category the group header
            already carries that swatch + label, so the row drops the
            rail to avoid a triple-encoded category color. */}
        <div
          className={hideCategory ? "pl-3 flex-1 min-w-0" : "border-l-4 pl-3 flex-1 min-w-0"}
          style={hideCategory ? undefined : { borderColor: category?.color ?? "var(--edge)" }}
        >
          {!hideCategory && (
            <div className="flex items-center gap-1.5">
              {category ? (
                <>
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: category.color }}
                  />
                  <Tooltip label={category.name}>
                    <span className="text-body-lg font-semibold text-content truncate">
                      {category.name}
                    </span>
                  </Tooltip>
                </>
              ) : (
                <span className="text-body-lg text-content-muted italic truncate">
                  —
                </span>
              )}
            </div>
          )}
          {/* When grouped by category the row's headline becomes the
              project name (the category lives in the group header).
              Promoted to the same loud weight as a category headline
              so visual hierarchy stays consistent. */}
          {hideCategory && !hideProject && (
            <Tooltip label={project?.name ?? "—"}>
              <div className="text-body-lg font-semibold text-content truncate">
                {project?.name ?? "—"}
              </div>
            </Tooltip>
          )}
          {/* Customer line — surfaced on every row that carries
              project context. Customer first because bookkeepers /
              agency owners scan client before project. Each line
              truncates independently (one shared truncation budget
              for "project · customer" on a 220px column was the
              source of "Pierce …" cut-offs); a Tooltip restores the
              full name on hover per the MANDATORY truncation-tooltip
              rule. */}
          {/* Customer identity. CustomerChip is a square initials
              tile drawn from the AVATAR_PRESETS palette and hashed
              on customer.id so the color is stable across renames.
              Replaces the all-caps "CUSTOMER" label — the chip
              itself signals the role (square = organization, paired
              with a name) per the Entity Identity rule.
              Internal projects (project.is_internal) get the
              Building glyph + "Internal" label instead of the
              missing-data treatment — the lack of a customer is
              intentional design, not a gap.
              `hideCustomer` is true when the row sits beneath a
              customer sub-group header (Member groupings only) —
              chip + name moves into the sub-header so contiguous
              same-customer rows don't repeat themselves. */}
          {!hideProject && !hideCustomer &&
            (project?.customers?.name ? (
              <div className="flex items-center gap-1.5 mt-1 min-w-0">
                <CustomerChip
                  customerId={project.customers.id ?? null}
                  customerName={project.customers.name}
                />
                <Tooltip label={project.customers.name}>
                  <div className="text-body text-content-secondary truncate min-w-0">
                    {project.customers.name}
                  </div>
                </Tooltip>
              </div>
            ) : project?.is_internal ? (
              <div className="flex items-center gap-1.5 mt-1 min-w-0">
                <CustomerChip
                  customerId={null}
                  customerName={null}
                  internal
                />
                <span className="text-body text-content-secondary truncate">
                  {t("row.internal")}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1 min-w-0">
                <CustomerChip
                  customerId={null}
                  customerName={null}
                />
                <span className="text-body text-content-muted italic truncate">
                  {t("row.noCustomer")}
                </span>
              </div>
            ))}
          {/* Project line — only when the row's headline is Category
              and Project isn't already promoted (hideCategory) or
              hidden into the group header (hideProject). The
              uppercase "PROJECT" prefix was dropped (persona review,
              2026-05-12): project is the only metadata line without
              a chip, so users identify it by elimination; the prefix
              shouted structure for no scanning gain and ate ~50px of
              truncation budget. */}
          {!hideCategory && !hideProject && (
            <Tooltip label={project?.name ?? t("row.noProject")}>
              <div className="text-body text-content-secondary truncate mt-1">
                {project?.name ?? (
                  <span className="italic text-content-muted">
                    {t("row.noProject")}
                  </span>
                )}
              </div>
            </Tooltip>
          )}
          {/* Identifying detail line — surfaces the entry's ticket
              chip and description so single-entry rows (the dominant
              case) aren't mute on the most-meaningful field while
              collapsed. Multi-entry rows fall back to a count badge;
              the auto-expanded sub-rows directly below carry the
              per-entry detail. Persona-converged design (refined
              Option B): visual treatment is a 1:1 copy of the
              EntrySummaryRow leading-cell pattern so the row reads
              the same expanded or collapsed. */}
          {(() => {
            const flat = flattenEntriesByDay(row.entriesByDay);
            if (flat.length === 0) return null;
            if (flat.length === 1) {
              const e = flat[0]!.entry;
              const ticketKey = e.linked_ticket_key;
              const ticketUrl = e.linked_ticket_url;
              const description = e.description ?? "";
              return (
                <div className="flex items-center gap-1.5 text-body mt-1 min-w-0">
                  {ticketKey ? (
                    ticketUrl ? (
                      <a
                        href={ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={tEntry("ticketLinkAria", { key: ticketKey })}
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
                  <Tooltip label={description || tEntry("untitled")}>
                    <span
                      className="text-body text-content-secondary truncate min-w-0"
                      aria-hidden="true"
                    >
                      {description || (
                        <span className="italic text-content-muted">
                          {tEntry("untitled")}
                        </span>
                      )}
                    </span>
                  </Tooltip>
                  <span className="sr-only">
                    {description || tEntry("untitled")}
                  </span>
                </div>
              );
            }
            return (
              <div className="text-caption text-content-muted mt-1">
                {t("row.entryCount", { count: flat.length })}
              </div>
            );
          })()}
          {showAuthorChip && (
            <div className="mt-1">
              <EntryAuthor author={row.author} size={16} />
            </div>
          )}
        </div>
        </div>
      </td>
      {row.byDay.map((min, i) => {
        const dayStr = weekDays[i];
        const isToday = dayStr === todayStr;
        const isWeekend = i >= 5;
        // Per-cell aria-label: "{Weekday Mon 4} — {Project} · {Category}".
        // Without this the DurationInput announced as "edit, 1:18" with
        // no day or project context — useless to a screen-reader user
        // arrow-keying through the grid.
        const cellWeekdayLong = (() => {
          if (!dayStr) return "";
          const parts = dayStr.split("-").map(Number);
          if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
            return dayStr;
          }
          const [y, m, d] = parts;
          return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          });
        })();
        const cellAriaLabel = t("cellAria", {
          weekday: cellWeekdayLong,
          project: project?.name ?? "—",
          categoryPart: category?.name
            ? t("cellAriaCategoryPart", { category: category.name })
            : "",
        });
        return (
          <td
            key={dayStr ?? i}
            // Today background continues from the header; weekend
            // tint only applies if today doesn't.
            className={`px-2 py-1 align-middle ${
              isToday
                ? "bg-accent-soft/40"
                : isWeekend
                  ? "bg-surface-inset/40"
                  : ""
            }`}
          >
            {/* Every variant below shares px-0 (the td's px-2 is the
                entire horizontal padding) so the right edge of each
                number lines up with the group-header per-day total,
                the daily-totals footer, and the other rows in the
                same column — all anchored at `right-edge − 8px`. */}
            {i === runningDayIndex && runningStartIso ? (
              // Live running cell. The row already carries a
              // ring-success/40 inset; the pulsing dot is the
              // second visual channel. Per-entry sub-rows (when the
              // row is expanded) carry the running entry's ticket
              // key — no need to repeat it here.
              <div className="flex items-center justify-end gap-1.5 w-full py-1 font-mono text-title tabular-nums text-content">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
                  aria-hidden="true"
                />
                {formatDurationHMZero(min + liveElapsedMin)}
              </div>
            ) : row.invoicedByDay[i] ? (
              // Locked cell — entry is invoiced and the DB trigger
              // refuses UPDATE/DELETE. Render as static read-only
              // with a Lock affordance so the user doesn't try to
              // edit and hit a server error. <Tooltip> wraps the
              // link so screen readers reliably announce the locked
              // state (native title= is unreliable across AT and
              // never exposed on touch — also banned by the project
              // ESLint rule for new TSX).
              <Tooltip label={tLock("locked")}>
                <Link
                  href={`/invoices/${row.invoiceIdByDay[i]}`}
                  aria-label={tLock("locked")}
                  className="flex w-full items-center justify-end gap-1.5 py-1 font-mono text-title tabular-nums text-content-muted hover:text-content"
                >
                  <Lock size={12} aria-hidden="true" className="text-warning" />
                  {formatDurationHMZero(min)}
                </Link>
              </Tooltip>
            ) : editable && !expanded ? (
              // Speed-cell typing path. Shown only when the row is
              // COLLAPSED — when expanded, per-entry sub-rows own
              // the per-day duration data and typing into the
              // aggregate "sum of N entries" cell would be undefined.
              // Wrapping <label> keeps the entire cell clickable —
              // clicking the empty space left of the input still
              // focuses the input — without the bordered focus ring
              // sprawling across the full 72px column.
              <label className="flex justify-end cursor-text">
                {/* `-mr-1.5` shifts the input right by exactly its
                    own internal pr-1.5, so the digits land on the
                    same `td_right - 8px` rail as group-header and
                    footer cells (which use text-right + td px-2,
                    no internal input). Without this, the input's
                    visual padding offsets its digits 6px left of
                    every other row's digits in the same column. */}
                <DurationInput
                  ref={(el) => setCellRef(rowIndex, i, el)}
                  name={`cell-${row.projectId}-${row.categoryId ?? ""}-${i}`}
                  defaultMinutes={min}
                  ariaLabel={cellAriaLabel}
                  onCommit={(committed) => {
                    if (committed !== null && committed !== min) {
                      void onCellCommit(i, committed);
                    }
                  }}
                  onArrowNav={(dir) => onArrowNav(dir, i)}
                  className="w-20 -mr-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-title outline-none transition-colors hover:border-edge-muted focus:border-focus-ring focus:bg-surface-raised focus:ring-2 focus:ring-focus-ring/30"
                />
              </label>
            ) : (
              // Expanded-row aggregate cell OR another user's row —
              // read-only total. Per-entry sub-rows below handle
              // the editable per-day durations.
              <div className="w-full py-1 text-right font-mono text-title tabular-nums text-content-muted">
                {min > 0 ? formatDurationHMZero(min) : <span className="text-content-muted">·</span>}
              </div>
            )}
          </td>
        );
      })}
      <td className="px-2 py-2 text-right font-mono text-title font-semibold tabular-nums text-content">
        {(() => {
          // Row total folds in the running entry's live minutes when
          // this row is the one hosting the running timer. Without
          // this, a row whose only entry is currently running (so its
          // saved duration_min is 0) renders as "—" while the day
          // cell next to it ticks up — confusing.
          const rowTotalDisplay =
            rowTotalSaved + (isRunningRow ? liveElapsedMin : 0);
          return rowTotalDisplay > 0 ? (
            formatDurationHMZero(rowTotalDisplay)
          ) : (
            <span className="text-content-muted">—</span>
          );
        })()}
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {editable &&
            (isRunningRow && onStopTimer ? (
              // This exact row has a running timer — swap in a red Stop
              // button. The live-ticking cell in the running day column
              // carries the "timer is running" signal on its own, so no
              // pulsing dot needed on the button itself. Aria-label
              // names the project + category so screen-reader users
              // hear what they're stopping.
              <Tooltip label={tEntry("stopTimerFromRow")}>
                <button
                  type="button"
                  onClick={onStopTimer}
                  aria-label={tEntry("stopTimerFromRowAria", {
                    project: project?.name ?? "—",
                    category: category?.name ?? "—",
                  })}
                  className="rounded p-1 text-error-text hover:bg-error-soft transition-colors"
                >
                  <Square size={16} className="fill-current" />
                </button>
              </Tooltip>
            ) : (
              // "Start timer" seeded from this row's project + category
              // for TODAY. Despite sitting in the row's actions column,
              // it never starts a timer for any other day — the tooltip
              // says so. Used to share a Space shortcut with the
              // running-timer-card; that was misleading because Space
              // is owned globally by the card and never reached this
              // button. Drop the kbd hint here.
              <Tooltip label={tEntry("startTimerForToday", { date: todayLong })}>
                <button
                  type="button"
                  onClick={onStartTimer}
                  aria-label={tEntry("startTimerFromRowAria", {
                    project: project?.name ?? "—",
                    category: category?.name ?? "—",
                    date: todayLong,
                  })}
                  className="rounded p-1 text-content-muted hover:bg-hover hover:text-accent transition-colors"
                >
                  <Play size={16} />
                </button>
              </Tooltip>
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
    {/* Per-entry sub-rows. Hidden when the row is collapsed; shown
        as real <tr>s when expanded so the column grid is reused.
        Sub-rows are only rendered for editable rows (own entries) —
        other members' entries display in their own row in the
        groupBy="member" view, no need to inline them here. */}
    {expanded && editable &&
      (() => {
        // Pre-format every visible day's long-form date once per
        // expand so the editable non-entry-day cells in
        // EntrySummaryRow can stamp aria-labels without re-parsing
        // for each cell.
        const dayDatesLong = weekDays.map((d) => formatDayLong(d));
        return flattenEntriesByDay(row.entriesByDay).map(({ entry, dayIndex: dIdx }) => {
        const dayStr = weekDays[dIdx];
        const dayLong = dayStr ? formatDayLong(dayStr) : "";
        const isRowEntryRunning =
          entry.end_time === null && runningStartIso !== null;
        // Reuse the running ticker the parent row already runs at
        // 1Hz (`runningNowMs` from setInterval) so we don't call
        // Date.now() inside render — pure-render lint rule and
        // also prevents drift between the parent cell's elapsed
        // and the sub-row's elapsed.
        const entryLiveElapsed = isRowEntryRunning
          ? Math.max(
              0,
              Math.floor(
                (runningNowMs - new Date(entry.start_time).getTime()) /
                  60_000,
              ),
            )
          : 0;
        return (
          <Fragment key={entry.id}>
            <EntrySummaryRow
              entry={entry}
              dayIndex={dIdx}
              editing={editingEntryId === entry.id}
              onEditToggle={() =>
                setEditingEntryId((cur) =>
                  cur === entry.id ? null : entry.id,
                )
              }
              dayDateLong={dayLong}
              isRunning={isRowEntryRunning}
              liveElapsedMin={entryLiveElapsed}
              customerRail={customerRail ?? undefined}
              onCellCommit={onCellCommit}
              dayDatesLong={dayDatesLong}
            />
            {editingEntryId === entry.id && (
              <EntryEditRow
                entry={entry}
                project={project}
                projects={projects}
                tzOffsetMin={tzOffsetMin}
                dayDateLong={dayLong}
                onClose={() => setEditingEntryId(null)}
              />
            )}
          </Fragment>
        );
        });
      })()}
    {expanded && editable && (
      <tr>
        <td colSpan={DAYS_IN_WEEK + 3} className="px-3 py-1.5">
          {addingEntry ? null : (
            <button
              type="button"
              onClick={() => setAddingEntry(true)}
              className={`${buttonGhostClass} text-caption ml-6`}
            >
              <Plus size={14} />
              {tCell("addEntry")}
            </button>
          )}
        </td>
      </tr>
    )}
    {expanded && editable && addingEntry && (
      <AddEntryRow
        project={project}
        categoryId={row.categoryId}
        weekDays={weekDays}
        defaultDayDateStr={todayStr}
        tzOffsetMin={tzOffsetMin}
        onClose={() => setAddingEntry(false)}
      />
    )}
    </>
  );
}

/** Format a YYYY-MM-DD string into the locale's long weekday + month
 *  + day (e.g. "Tuesday, May 5"). Used for sub-row aria-labels and
 *  the entry-edit drawer header. */
function formatDayLong(dayStr: string): string {
  const parts = dayStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dayStr;
  const [y, m, d] = parts;
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
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
  tzOffsetMin,
  setCellRef,
  focusCell,
  onCellCommit,
  onDelete,
  onDiscardEmpty,
  onStartTimer,
  runningEntry,
  runningDayIndex,
  onStopTimer,
  currentTeamRole,
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
  tzOffsetMin: number | undefined;
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
    resumeEntryId: string | null,
  ) => void | Promise<void>;
  runningEntry: TimeEntry | null;
  /** Day-column (0–6) that `runningEntry` falls on in this week, or -1. */
  runningDayIndex: number;
  onStopTimer: (entryId: string) => void | Promise<void>;
  currentTeamRole: "owner" | "admin" | "member";
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
              <ChevronRight size={16} className="shrink-0 text-content-muted" />
            ) : (
              <ChevronDown size={16} className="shrink-0 text-content-muted" />
            )}
            <GroupLabel group={group} groupBy={groupBy} />
            {/* Row count only — the duration sat next to the
                already-displayed week-total cell on the same row,
                visually duplicating the canonical answer. Plain
                text (not mono): mono is reserved for column-aligned
                durations / money, this is metadata. */}
            <span className="text-caption text-content-muted ml-auto pr-2">
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
              // Today gets the unified accent band; digit color stays
              // text-content-secondary so the value doesn't read as an
              // accent link sitting on top of an accent surface.
              className={`px-2 py-1.5 text-right font-mono text-title font-semibold tabular-nums text-content-secondary ${
                isToday
                  ? "bg-accent-soft/40"
                  : isWeekend
                    ? "bg-surface-inset/80"
                    : ""
              }`}
            >
              {min > 0 ? (
                formatDurationHMZero(min)
              ) : (
                <span className="text-content-muted">·</span>
              )}
            </td>
          );
        })}
        <td className="px-2 py-1.5 text-right font-mono text-title font-semibold tabular-nums text-content">
          {formatDurationHMZero(group.totalMin)}
        </td>
        <td className="px-2 py-1.5" />
      </tr>
      {!collapsed &&
        renderGroupedRows({
          group,
          groupBy,
          projects,
          categories,
          rowsFlat,
          weekDays,
          todayStr,
          tzOffsetMin,
          setCellRef,
          focusCell,
          onCellCommit,
          onDelete,
          onDiscardEmpty,
          onStartTimer,
          runningEntry,
          runningDayIndex,
          onStopTimer,
          currentTeamRole,
        })}
    </tbody>
  );
}

/** Customer sub-grouping inside a Member-grouped block. Contiguous
 *  rows from the same customer collapse into a sub-group with a
 *  shared header; single-row customers render inline (no sub-header
 *  for a group of one). Persona-converged design (UX + solo + agency
 *  + a11y, 2026-05-12): the same customer name repeating on three
 *  consecutive rows didn't communicate grouping — the sub-header
 *  carries the chip + name + per-day subtotals once, and the rows
 *  beneath drop their per-row customer line. */
interface CustomerSubGroup {
  /** Customer id, or null for internal/no-customer rows. */
  customerId: string | null;
  customerName: string | null;
  /** True when the rows in this sub-group belong to projects flagged
   *  is_internal — surfaces as a "Internal" label + Building chip. */
  isInternal: boolean;
  rows: Row[];
  byDay: number[];
  totalMin: number;
}

function buildCustomerSubGroups(
  rows: Row[],
  projects: ProjectOption[],
  categories: CategoryOption[],
): CustomerSubGroup[] {
  const byKey = new Map<string, CustomerSubGroup>();
  for (const row of rows) {
    const project = projects.find((p) => p.id === row.projectId);
    const customer = project?.customers ?? null;
    const isInternal = !customer && project?.is_internal === true;
    const key = customer?.id ?? (isInternal ? "__internal__" : "__no_customer__");
    let sg = byKey.get(key);
    if (!sg) {
      sg = {
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        isInternal,
        rows: [],
        byDay: Array.from({ length: DAYS_IN_WEEK }, () => 0),
        totalMin: 0,
      };
      byKey.set(key, sg);
    }
    sg.rows.push(row);
    for (let i = 0; i < DAYS_IN_WEEK; i++) {
      const m = row.byDay[i] ?? 0;
      sg.byDay[i] = (sg.byDay[i] ?? 0) + m;
      sg.totalMin += m;
    }
  }
  // Sort customer sub-groups: named customers alpha first, then
  // Internal, then No-customer. Predictable scan order for owners.
  const out = Array.from(byKey.values()).sort((a, b) => {
    const rank = (s: CustomerSubGroup): number => {
      if (s.customerName) return 0;
      if (s.isInternal) return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.customerName ?? "").localeCompare(b.customerName ?? "");
  });
  // Sort rows inside each sub-group by category name then project
  // name. Without this the order is insertion-order from the upstream
  // Map — arbitrary across renders.
  for (const sg of out) {
    sg.rows.sort((a, b) => {
      const catA =
        (a.categoryId
          ? categories.find((c) => c.id === a.categoryId)?.name
          : null) ?? "";
      const catB =
        (b.categoryId
          ? categories.find((c) => c.id === b.categoryId)?.name
          : null) ?? "";
      if (catA !== catB) return catA.localeCompare(catB);
      const projA = projects.find((p) => p.id === a.projectId)?.name ?? "";
      const projB = projects.find((p) => p.id === b.projectId)?.name ?? "";
      return projA.localeCompare(projB);
    });
  }
  return out;
}

interface RenderGroupedRowsArgs {
  group: RowGroup;
  groupBy: GroupBy;
  projects: ProjectOption[];
  categories: CategoryOption[];
  rowsFlat: Row[];
  weekDays: string[];
  todayStr: string;
  tzOffsetMin: number | undefined;
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
    /** Latest entry id on the row to resume from. Null when the row
     *  has no entries yet (brand-new typed-add row) — then a new
     *  blank entry seeds from project + category. */
    resumeEntryId: string | null,
  ) => void | Promise<void>;
  runningEntry: TimeEntry | null;
  runningDayIndex: number;
  onStopTimer: (entryId: string) => void | Promise<void>;
  currentTeamRole: "owner" | "admin" | "member";
}

function renderGroupedRows(args: RenderGroupedRowsArgs): React.JSX.Element[] {
  const { group, groupBy, projects, weekDays, todayStr } = args;
  // Customer sub-grouping only fires under Member groupings — under
  // Project (one customer per group) it's degenerate, and under
  // Category it would shatter the same category across customers,
  // which is the opposite of what scanning by category wants.
  if (groupBy !== "member") {
    return group.rows.map((row) => renderTimesheetRow(args, row, false));
  }
  const subGroups = buildCustomerSubGroups(group.rows, projects, args.categories);
  const out: React.JSX.Element[] = [];
  // Always emit a customer sub-header — even for single-row customers.
  // Previously we auto-inlined 1-row customers to save vertical space,
  // but that created two visual languages inside the same Member group
  // (multi-row → header + nested rows; single-row → plain row with
  // inline chip). Consistency wins: every customer reads the same.
  for (const sg of subGroups) {
    const headerKey = `cust:${sg.customerId ?? (sg.isInternal ? "__internal__" : "__none__")}`;
    out.push(
      <CustomerSubHeader
        key={`${headerKey}:header`}
        subGroup={sg}
        weekDays={weekDays}
        todayStr={todayStr}
      />,
    );
    for (const row of sg.rows) {
      out.push(renderTimesheetRow(args, row, true));
    }
  }
  return out;
}

function renderTimesheetRow(
  args: RenderGroupedRowsArgs,
  row: Row,
  hideCustomer: boolean,
): React.JSX.Element {
  const {
    groupBy,
    projects,
    categories,
    rowsFlat,
    weekDays,
    todayStr,
    tzOffsetMin,
    setCellRef,
    focusCell,
    onCellCommit,
    onDelete,
    onDiscardEmpty,
    onStartTimer,
    runningEntry,
    runningDayIndex,
    onStopTimer,
    currentTeamRole,
  } = args;
  const rowIdx = rowsFlat.indexOf(row);
  const isRunningRow =
    !!runningEntry &&
    runningEntry.project_id === row.projectId &&
    runningEntry.category_id === row.categoryId &&
    runningEntry.user_id === row.userId;
  return (
    <TimesheetRow
      key={`${row.projectId}::${row.categoryId ?? ""}::${row.userId}`}
      rowIndex={rowIdx}
      row={row}
      projects={projects}
      categories={categories}
      groupBy={groupBy}
      hideCustomer={hideCustomer}
      onCellCommit={(dayIndex, minutes) =>
        onCellCommit(row.projectId, row.categoryId, dayIndex, minutes)
      }
      onDelete={() => {
        void onDelete(row.projectId, row.categoryId, row.userId);
      }}
      onDiscardEmpty={() => onDiscardEmpty(row.projectId, row.categoryId)}
      onStartTimer={() => {
        // Resume the row's most-recent entry instead of creating a
        // brand-new untitled one. Across all visible days, pick the
        // entry with the latest start_time. Null when the row has no
        // entries yet — startTimerAction then seeds a new entry from
        // (project, category) only.
        const flat = row.entriesByDay.flat();
        const latest = flat.reduce<{ id: string; t: number } | null>(
          (acc, e) => {
            const t = new Date(e.start_time).getTime();
            if (Number.isNaN(t)) return acc;
            if (acc === null || t > acc.t) return { id: e.id, t };
            return acc;
          },
          null,
        );
        void onStartTimer(row.projectId, row.categoryId, latest?.id ?? null);
      }}
      isRunningRow={isRunningRow}
      runningStartIso={isRunningRow ? runningEntry.start_time : null}
      runningDayIndex={isRunningRow ? runningDayIndex : -1}
      onStopTimer={
        isRunningRow ? () => void onStopTimer(runningEntry.id) : undefined
      }
      weekDays={weekDays}
      todayStr={todayStr}
      tzOffsetMin={tzOffsetMin}
      setCellRef={setCellRef}
      onArrowNav={(dir, dayIdx) => {
        if (dir === "up") focusCell(rowIdx - 1, dayIdx, "up");
        else if (dir === "down") focusCell(rowIdx + 1, dayIdx, "down");
        else if (dir === "left") focusCell(rowIdx, dayIdx - 1);
        else focusCell(rowIdx, dayIdx + 1);
      }}
      currentTeamRole={currentTeamRole}
    />
  );
}

/** Customer sub-header inside a Member group. Quieter than the
 *  Member group header (no chevron, lighter background, smaller
 *  indentation step) so the visual hierarchy reads:
 *    Member header (loud) → Customer sub-header (medium) → row.
 *  Uses `<th scope="rowgroup">` for AT semantics — the customer
 *  name announces as the rowgroup label, and the chip stays
 *  aria-hidden per the Entity Identity rule. */
function CustomerSubHeader({
  subGroup,
  weekDays,
  todayStr,
}: {
  subGroup: CustomerSubGroup;
  weekDays: string[];
  todayStr: string;
}): React.JSX.Element {
  const tSub = useTranslations("time.timesheet.customerSubgroup");
  const customerName = subGroup.customerName
    ? subGroup.customerName
    : subGroup.isInternal
      ? tSub("internal")
      : tSub("noCustomer");
  // Hashed customer color — drives both the chip and the left rail
  // so the sub-header and its rows below read as a single vertical
  // customer band. Internal / no-customer use a neutral edge color
  // (matches the Building chip's surface) so the rail is still
  // visible without pretending to be a hashed identity.
  const rail = customerRailColor(subGroup.customerId);
  const railColor = rail ?? "var(--edge)";
  return (
    <tr className="bg-surface-inset/70 border-y border-edge-muted">
      <th
        scope="rowgroup"
        className="py-1.5 pl-6 pr-2 align-middle text-left font-normal border-l-4"
        style={{ borderLeftColor: railColor }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {subGroup.customerName ? (
            <CustomerChip
              customerId={subGroup.customerId}
              customerName={subGroup.customerName}
              size={18}
            />
          ) : subGroup.isInternal ? (
            <CustomerChip
              customerId={null}
              customerName={null}
              internal
              size={18}
            />
          ) : (
            <CustomerChip
              customerId={null}
              customerName={null}
              size={18}
            />
          )}
          <Tooltip label={customerName}>
            <span
              className={`text-body-lg font-semibold truncate min-w-0 ${
                subGroup.customerName
                  ? "text-content"
                  : "text-content-muted italic"
              }`}
            >
              {customerName}
            </span>
          </Tooltip>
        </div>
      </th>
      {subGroup.byDay.map((min, i) => {
        const dayStr = weekDays[i];
        const isToday = dayStr === todayStr;
        const isWeekend = i >= 5;
        return (
          <td
            key={dayStr ?? i}
            className={`px-2 py-1 text-right font-mono text-body tabular-nums text-content-secondary ${
              isToday
                ? "bg-accent-soft/40"
                : isWeekend
                  ? "bg-surface-inset/40"
                  : ""
            }`}
          >
            {min > 0 ? (
              formatDurationHMZero(min)
            ) : (
              <span className="text-content-muted" aria-hidden="true">
                ·
              </span>
            )}
          </td>
        );
      })}
      <td
        className="px-2 py-1 text-right font-mono text-body font-semibold tabular-nums text-content"
        aria-label={tSub("subtotalAria", {
          customer: customerName,
          duration: formatDurationHMZero(subGroup.totalMin),
        })}
      >
        {formatDurationHMZero(subGroup.totalMin)}
      </td>
      <td className="px-2 py-1" />
    </tr>
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
    // Empty-state nudge: when this is the user's first row of the week,
    // a more inviting label makes the path forward obvious. Once the
    // sheet has any content, the terse "Add row" wins because the
    // button is no longer the hero CTA.
    const label = existingRows.length === 0 ? t("addFirstRow") : t("addRow");
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonSecondaryClass}
      >
        <Plus size={16} />
        {label}
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
          <Plus size={16} />
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

/**
 * Pin / unpin a row for the viewer. Tiny stateful component because
 * the pin action toggles between two server-side mutations and we
 * want to show a pending spinner during the call. Optimistic state
 * is local so the icon flips immediately; on action error the
 * useFormAction layer surfaces the toast and the page revalidate
 * will reset the displayed pin state.
 */
function PinRowButton({
  teamId,
  projectId,
  categoryId,
  isPinned,
}: {
  teamId: string;
  projectId: string;
  categoryId: string | null;
  isPinned: boolean;
}): React.JSX.Element {
  const t = useTranslations("time.timesheet.pin");
  const [optimistic, setOptimistic] = useState<boolean>(isPinned);
  const [pending, setPending] = useState<boolean>(false);
  const handleClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    const next = !optimistic;
    setOptimistic(next);
    const fd = new FormData();
    fd.set("team_id", teamId);
    fd.set("project_id", projectId);
    if (categoryId) fd.set("category_id", categoryId);
    try {
      if (next) await pinRowAction(fd);
      else await unpinRowAction(fd);
    } catch {
      // Roll back optimistic state on error. The action's runSafeAction
      // wrapper logs server-side; the UI just snaps back.
      setOptimistic(!next);
    } finally {
      setPending(false);
    }
  }, [pending, optimistic, teamId, projectId, categoryId]);
  return (
    <Tooltip label={optimistic ? t("unpin") : t("pin")}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={optimistic}
        aria-label={optimistic ? t("unpin") : t("pin")}
        className={`mt-1 inline-flex shrink-0 items-center rounded p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
          optimistic
            ? "text-accent hover:bg-hover"
            : "text-content-muted/60 hover:bg-hover hover:text-content"
        }`}
      >
        <Pin
          size={13}
          className={optimistic ? "fill-current" : ""}
        />
      </button>
    </Tooltip>
  );
}

/**
 * First-render-of-new-week banner. Shows once per weekStartStr —
 * the dismiss writes the weekStartStr to localStorage so future
 * mounts of the same week stay quiet. Counts carried-forward rows
 * (active rows without entries this week yet) so the user knows
 * the count is meaningful, not a generic prompt.
 */
const NEW_WEEK_DISMISS_KEY = "shyre.timesheet.newWeekBannerDismissed";
const NEW_WEEK_DISMISS_EVENT = "shyre:timesheet:newWeekBannerDismissed";

function subscribeNewWeekDismiss(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener(NEW_WEEK_DISMISS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(NEW_WEEK_DISMISS_EVENT, cb);
  };
}

function getNewWeekDismissSnapshot(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NEW_WEEK_DISMISS_KEY) ?? "";
}

function getServerNewWeekDismissSnapshot(): string {
  return "";
}

function NewWeekRolloverBanner({
  weekStartStr,
  carriedRowsCount,
}: {
  weekStartStr: string;
  carriedRowsCount: number;
}): React.JSX.Element | null {
  const t = useTranslations("time.timesheet.newWeekBanner");
  // useSyncExternalStore subscribes to the localStorage key without
  // setState-in-effect — server renders default-not-dismissed, client
  // reconciles to the stored value post-hydration cleanly.
  const dismissedFor = useSyncExternalStore(
    subscribeNewWeekDismiss,
    getNewWeekDismissSnapshot,
    getServerNewWeekDismissSnapshot,
  );
  const dismissed = dismissedFor === weekStartStr;
  const onDismiss = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NEW_WEEK_DISMISS_KEY, weekStartStr);
      window.dispatchEvent(new Event(NEW_WEEK_DISMISS_EVENT));
    }
  }, [weekStartStr]);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3 flex items-start gap-3"
    >
      <Pin size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-body-lg font-semibold text-content">
          {t("title", { count: carriedRowsCount })}
        </p>
        <p className="text-caption text-content-secondary mt-0.5">
          {t("body")}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-caption text-accent hover:underline shrink-0"
      >
        {t("dismiss")}
      </button>
    </div>
  );
}

/**
 * Set / unset a row as a team default. Admin- and owner-only —
 * gated upstream (the button only renders when isTeamAdmin). The
 * action also enforces requireTeamAdmin server-side so a tampered
 * client can't sneak past. Members see only the read-only "Team"
 * chip on rows already defaulted; the chip lives on the customer
 * line (see TimesheetRow's customer block render).
 */
function TeamDefaultRowButton({
  teamId,
  projectId,
  categoryId,
  isTeamDefault,
}: {
  teamId: string;
  projectId: string;
  categoryId: string | null;
  isTeamDefault: boolean;
}): React.JSX.Element {
  const t = useTranslations("time.timesheet.pin");
  const [optimistic, setOptimistic] = useState<boolean>(isTeamDefault);
  const [pending, setPending] = useState<boolean>(false);
  const handleClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    const next = !optimistic;
    setOptimistic(next);
    const fd = new FormData();
    fd.set("team_id", teamId);
    fd.set("project_id", projectId);
    if (categoryId) fd.set("category_id", categoryId);
    try {
      if (next) await setTeamDefaultRowAction(fd);
      else await unsetTeamDefaultRowAction(fd);
    } catch {
      setOptimistic(!next);
    } finally {
      setPending(false);
    }
  }, [pending, optimistic, teamId, projectId, categoryId]);
  return (
    <Tooltip
      label={
        optimistic ? t("teamDefaultUnset") : t("teamDefaultSet")
      }
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={optimistic}
        aria-label={
          optimistic ? t("teamDefaultUnset") : t("teamDefaultSet")
        }
        className={`mt-1 inline-flex shrink-0 items-center rounded p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
          optimistic
            ? "text-accent hover:bg-hover"
            : "text-content-muted/60 hover:bg-hover hover:text-content"
        }`}
      >
        <Users
          size={13}
          className={optimistic ? "fill-current" : ""}
        />
      </button>
    </Tooltip>
  );
}
