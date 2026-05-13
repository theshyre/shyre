"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { formatDurationHMZero } from "@/lib/time/week";
import { addLocalDays, utcToLocalDateStr } from "@/lib/time/tz";
import { localDayBoundsIso } from "@/lib/local-day-bounds";
import { Spinner, useKeyboardShortcut } from "@theshyre/ui";
import { EntryTable } from "./entry-table";
import { JumpToDate } from "./jump-to-date";
import { groupEntriesByCustomer } from "./customer-grouping";
import { CustomerChip } from "@/components/CustomerChip";
import { Tooltip } from "@/components/Tooltip";
import { startTimerAction } from "./actions";
import { notifyTimerChanged } from "@/lib/timer-events";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";
import type { EntryGroup } from "@/lib/time/grouping";

interface Props {
  /** The local date being viewed (YYYY-MM-DD) */
  dayStr: string;
  /** Local date of the Monday of the visible week (YYYY-MM-DD) */
  weekStartStr: string;
  /** User's TZ offset, minutes west of UTC */
  tzOffsetMin: number;
  weekEntries: TimeEntry[];
  dayEntries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  /** auth.uid() of the viewer — threaded through to the entry rows
   *  so the ticket-link chip's refresh button is gated to the
   *  entry's author. */
  viewerUserId: string | null;
  /** Active rows for the viewer on this team (union of recent
   *  entries, personal pins, team defaults). Drives the "From this
   *  week" ghost section above the day's entries — each (project,
   *  category) that doesn't have an entry on the visible day
   *  surfaces as a ghost row with a Play button so the user can
   *  start a timer without bouncing to Week view. */
  activeRows?: ReadonlyArray<{
    projectId: string;
    categoryId: string | null;
    source: string;
  }>;
}

/**
 * Pretty-format a local-date string like "2026-04-14" as "Tuesday, Apr 14",
 * prefixed with "Today: " if it's today in the user's TZ.
 */
function formatDayTitle(dateStr: string, todayStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!); // local
  const thisYear = new Date().getFullYear();
  const body = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: y !== thisYear ? "numeric" : undefined,
  });
  return dateStr === todayStr ? `Today: ${body}` : body;
}

export function DayView({
  dayStr,
  weekStartStr,
  tzOffsetMin,
  weekEntries,
  dayEntries,
  projects,
  categories,
  viewerUserId,
  activeRows = [],
}: Props): React.JSX.Element {
  const t = useTranslations("time.dayView");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedEntryId((c) => (c === id ? null : id));
  }, []);

  // Optimistic selected day so clicks feel instant while the server
  // re-renders for the new anchor. No reset effect needed — once the server
  // catches up, optimisticDay === dayStr so visibleDay resolves to the same
  // value either way. The next click replaces optimisticDay in place.
  const [optimisticDay, setOptimisticDay] = useState<string | null>(null);
  const visibleDay = optimisticDay ?? dayStr;

  // Today's local-date string (for "Today:" prefix and strip highlight)
  const todayStr = useMemo(
    () => utcToLocalDateStr(new Date(), tzOffsetMin),
    [tzOffsetMin],
  );

  // Precompute the 7 day-strings for the week strip
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addLocalDays(weekStartStr, i)),
    [weekStartStr],
  );

  // Daily totals indexed by weekDays[i]
  const dailyTotals = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of weekEntries) {
      const key = utcToLocalDateStr(e.start_time, tzOffsetMin);
      byDay.set(key, (byDay.get(key) ?? 0) + (e.duration_min ?? 0));
    }
    return weekDays.map((d) => byDay.get(d) ?? 0);
  }, [weekEntries, weekDays, tzOffsetMin]);

  const weekTotal = dailyTotals.reduce((s, n) => s + n, 0);

  const navigateToDay = useCallback(
    (targetDayStr: string) => {
      if (targetDayStr === visibleDay) return;
      setOptimisticDay(targetDayStr);
      const params = new URLSearchParams(searchParams.toString());
      params.set("anchor", targetDayStr);
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams, visibleDay],
  );

  const goPrev = useCallback(() => {
    navigateToDay(addLocalDays(visibleDay, -1));
  }, [visibleDay, navigateToDay]);

  const goNext = useCallback(() => {
    navigateToDay(addLocalDays(visibleDay, 1));
  }, [visibleDay, navigateToDay]);

  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: goPrev });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: goNext });

  const titleLabel = formatDayTitle(visibleDay, todayStr);

  // Filter dayEntries client-side to the currently-visible day (defense against
  // optimistic-day / server-data lag).
  const trulyDayEntries = useMemo(() => {
    return dayEntries.filter(
      (e) => utcToLocalDateStr(e.start_time, tzOffsetMin) === visibleDay,
    );
  }, [dayEntries, visibleDay, tzOffsetMin]);

  // Build customer-grouped EntryGroups from the day's entries via the
  // shared helper — same machinery the Log view uses, so day & log
  // render the same customer order / chip color / Internal handling.
  // Part of the time-views parity rule (memory: feedback_time_views_parity).
  const tTimesheet = useTranslations("time.timesheet.customerSubgroup");
  const groups: EntryGroup<TimeEntry>[] = useMemo(
    () =>
      groupEntriesByCustomer(trulyDayEntries, projects, {
        internal: tTimesheet("internal"),
        noCustomer: tTimesheet("noCustomer"),
      }),
    [trulyDayEntries, projects, tTimesheet],
  );
  // titleLabel is no longer used as a group header — the 7-day strip
  // already announces the visible day. Kept for future surfaces.
  void titleLabel;

  // Ghost rows = active rows (pin / team-default / recent) that
  // DON'T have an entry on the visible day. Lets the user start a
  // timer or stub an entry on Wednesday without bouncing to Week
  // view to find the right (project, category) combo.
  const ghostRows = useMemo(() => {
    const dayEntryKeys = new Set(
      trulyDayEntries.map(
        (e) => `${e.project_id}::${e.category_id ?? ""}`,
      ),
    );
    return activeRows.filter(
      (r) => !dayEntryKeys.has(`${r.projectId}::${r.categoryId ?? ""}`),
    );
  }, [activeRows, trulyDayEntries]);

  return (
    <div className="space-y-4">
      {/* Header: jump-to-date with prev / next arrows. The shared
          control supplies the trigger label, the popover, and the
          Today pill — Day-view passes its goPrev/goNext handlers
          so the arrows still page one day at a time. */}
      <div className="flex items-center gap-3">
        <JumpToDate
          view="day"
          anchorStr={visibleDay}
          todayStr={todayStr}
          tzOffsetMin={tzOffsetMin}
          onPrev={goPrev}
          onNext={goNext}
          prevLabel={t("prevDay")}
          nextLabel={t("nextDay")}
        />
        {isPending && <Spinner color="border-t-content-muted" />}
      </div>

      {/* 7-day strip with daily totals */}
      <div className="rounded-lg border border-edge bg-surface-raised p-2">
        <div className="grid grid-cols-8 gap-1 items-stretch">
          {weekDays.map((dStr, i) => {
            const [y, m, d] = dStr.split("-").map(Number);
            const dateObj = new Date(y!, m! - 1, d!);
            const isCurrent = dStr === visibleDay;
            const isTodayPill = dStr === todayStr;
            const tot = dailyTotals[i] ?? 0;
            return (
              <button
                key={dStr}
                type="button"
                onClick={() => navigateToDay(dStr)}
                aria-pressed={isCurrent}
                className={`flex flex-col items-center py-2 rounded-md transition-colors border ${
                  isCurrent
                    ? "bg-accent text-content-inverse border-accent shadow-sm"
                    : isTodayPill
                    ? "border-accent/40 bg-surface-inset text-content hover:bg-hover"
                    : "border-transparent text-content-secondary hover:bg-hover"
                }`}
              >
                <span className="text-[10px] font-semibold uppercase">
                  {dateObj.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="text-body-lg font-semibold mt-0.5">
                  {d}
                </span>
                <span
                  className={`font-mono text-[11px] tabular-nums mt-0.5 ${
                    isCurrent ? "opacity-90" : "text-content-muted"
                  }`}
                >
                  {formatDurationHMZero(tot)}
                </span>
              </button>
            );
          })}
          <div className="flex flex-col items-center justify-center border-l border-edge pl-2">
            <span className="text-[10px] font-semibold uppercase text-content-muted">
              {t("weekTotal")}
            </span>
            <span className="font-mono text-body-lg font-semibold tabular-nums text-content mt-0.5">
              {formatDurationHMZero(weekTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* "From this week" ghost section — active rows (pinned /
          team-default / recent) that don't have an entry on the
          visible day. Click Play on any to start a timer for that
          (project, category) right now. Hidden when no ghost rows
          exist; auto-collapsed when the day already has more than
          two entries (less likely to need the shortcut). */}
      {ghostRows.length > 0 && (
        <GhostRowsSection
          rows={ghostRows}
          projects={projects}
          categories={categories}
          defaultExpanded={trulyDayEntries.length <= 2}
        />
      )}

      {/* Entries for this day */}
      <div className={isPending ? "opacity-60 transition-opacity" : ""}>
        <EntryTable
          groups={groups}
          projects={projects}
          categories={categories}
          expandedEntryId={expandedEntryId}
          onToggleExpand={toggleExpanded}
          tzOffsetMin={tzOffsetMin}
          viewerUserId={viewerUserId}
        />
      </div>
    </div>
  );
}

/**
 * "From this week" ghost rows. Each row's Play button kicks off
 * startTimerAction with (project_id, category_id) — a fresh timer
 * for that combo. Doesn't carry an entry description (resume) since
 * the ghost row's identity is "I haven't logged on this row today,
 * start now"; if the user wants to resume a prior entry's identity,
 * they can use that entry's own Play button in the Week view.
 */
function GhostRowsSection({
  rows,
  projects,
  categories,
  defaultExpanded,
}: {
  rows: ReadonlyArray<{
    projectId: string;
    categoryId: string | null;
    source: string;
  }>;
  projects: ProjectOption[];
  categories: CategoryOption[];
  defaultExpanded: boolean;
}): React.JSX.Element {
  const t = useTranslations("time.dayView.ghost");
  const tSubgroup = useTranslations("time.timesheet.customerSubgroup");
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  return (
    <section
      role="region"
      aria-label={t("regionLabel")}
      className="rounded-lg border border-edge bg-surface-raised"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-hover transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-content-muted" />
        ) : (
          <ChevronRight size={14} className="text-content-muted" />
        )}
        <span className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("title")}
        </span>
        <span className="text-caption text-content-muted">
          · {rows.length}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-edge-muted/60 border-t border-edge-muted">
          {rows.map((row) => (
            <GhostRow
              key={`${row.projectId}::${row.categoryId ?? ""}`}
              row={row}
              projects={projects}
              categories={categories}
              tSubgroup={tSubgroup}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GhostRow({
  row,
  projects,
  categories,
  tSubgroup,
}: {
  row: { projectId: string; categoryId: string | null; source: string };
  projects: ProjectOption[];
  categories: CategoryOption[];
  tSubgroup: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  const t = useTranslations("time.dayView.ghost");
  const project = projects.find((p) => p.id === row.projectId);
  const category = row.categoryId
    ? categories.find((c) => c.id === row.categoryId)
    : null;
  const customer = project?.customers ?? null;
  const isInternal = !customer && project?.is_internal === true;
  const customerLabel = customer?.name
    ? customer.name
    : isInternal
      ? tSubgroup("internal")
      : tSubgroup("noCustomer");
  const isTeamDefault = row.source.split(",").includes("team_default");

  const [pending, setPending] = useState<boolean>(false);
  const handleStart = useCallback(async () => {
    if (pending) return;
    setPending(true);
    const fd = new FormData();
    fd.set("project_id", row.projectId);
    if (row.categoryId) fd.set("category_id", row.categoryId);
    const [dayStart, dayEnd] = localDayBoundsIso();
    fd.set("day_start_iso", dayStart);
    fd.set("day_end_iso", dayEnd);
    try {
      await startTimerAction(fd);
      notifyTimerChanged();
    } finally {
      setPending(false);
    }
  }, [pending, row.projectId, row.categoryId]);

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      {customer ? (
        <CustomerChip
          customerId={customer.id ?? null}
          customerName={customer.name}
          size={14}
        />
      ) : (
        <CustomerChip
          customerId={null}
          customerName={null}
          internal={isInternal}
          size={14}
        />
      )}
      <span className="text-caption text-content-muted truncate min-w-0">
        {customerLabel}
      </span>
      <span className="text-content-muted text-caption" aria-hidden>
        ·
      </span>
      <span className="text-body text-content truncate min-w-0">
        {project?.name ?? "—"}
      </span>
      {category && (
        <>
          <span className="text-content-muted text-caption" aria-hidden>
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 text-caption text-content-secondary truncate min-w-0">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
              aria-hidden
            />
            {category.name}
          </span>
        </>
      )}
      {isTeamDefault && (
        <span className="text-label uppercase tracking-wider text-content-muted rounded bg-surface-inset px-1.5 py-0.5">
          {t("teamBadge")}
        </span>
      )}
      <span className="ml-auto inline-flex items-center gap-2">
        <Tooltip label={t("startTimer")}>
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            aria-label={t("startTimer")}
            className="rounded p-1.5 text-content-muted hover:bg-hover hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <Play size={14} />
          </button>
        </Tooltip>
      </span>
    </li>
  );
}
