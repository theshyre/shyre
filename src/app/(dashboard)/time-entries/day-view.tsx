"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatDurationHMZero } from "@/lib/time/week";
import { addLocalDays, utcToLocalDateStr } from "@/lib/time/tz";
import { Spinner, useKeyboardShortcut } from "@theshyre/ui";
import { EntryTable } from "./entry-table";
import { JumpToDate } from "./jump-to-date";
import { customerRailColor } from "@/components/CustomerChip";
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

  // Build customer-grouped EntryGroups from the day's entries — same
  // pattern the week view's CustomerSubHeader uses, just routed
  // through EntryTable's existing groups + GroupBlock infrastructure.
  // Each customer's rows form a connected vertical band via the
  // hashed rail color so day and week share one visual language.
  const tTimesheet = useTranslations("time.timesheet.customerSubgroup");
  const groups: EntryGroup<TimeEntry>[] = useMemo(() => {
    if (trulyDayEntries.length === 0) return [];
    interface CustomerBucket {
      customerId: string | null;
      customerName: string | null;
      isInternal: boolean;
      entries: TimeEntry[];
    }
    const byKey = new Map<string, CustomerBucket>();
    for (const e of trulyDayEntries) {
      const project = projects.find((p) => p.id === e.project_id);
      const customer = project?.customers ?? null;
      const isInternal = !customer && project?.is_internal === true;
      const key =
        customer?.id ?? (isInternal ? "__internal__" : "__no_customer__");
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = {
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          isInternal,
          entries: [],
        };
        byKey.set(key, bucket);
      }
      bucket.entries.push(e);
    }
    const buckets = Array.from(byKey.values()).sort((a, b) => {
      const rank = (x: CustomerBucket): number => {
        if (x.customerName) return 0;
        if (x.isInternal) return 1;
        return 2;
      };
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.customerName ?? "").localeCompare(b.customerName ?? "");
    });
    return buckets.map((b): EntryGroup<TimeEntry> => {
      const sorted = [...b.entries].sort(
        (a, c) =>
          new Date(a.start_time).getTime() - new Date(c.start_time).getTime(),
      );
      const label = b.customerName
        ? b.customerName
        : b.isInternal
          ? tTimesheet("internal")
          : tTimesheet("noCustomer");
      const rail = customerRailColor(b.customerId) ?? "var(--edge)";
      return {
        id: `cust:${b.customerId ?? (b.isInternal ? "__internal__" : "__no_customer__")}`,
        label,
        entries: sorted,
        totalMin: sorted.reduce((s, e) => s + (e.duration_min ?? 0), 0),
        billableMin: sorted
          .filter((e) => e.billable)
          .reduce((s, e) => s + (e.duration_min ?? 0), 0),
        customerId: b.customerId,
        isInternalCustomer: b.isInternal,
        railColor: rail,
      };
    });
  }, [trulyDayEntries, projects, tTimesheet]);
  // titleLabel is no longer used as a group header — kept for future
  // surfaces (e.g. screen-reader-only context). The 7-day strip
  // already announces the visible day.
  void titleLabel;

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
