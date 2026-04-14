"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { formatDurationHMZero } from "@/lib/time/week";
import { addLocalDays, utcToLocalDateStr } from "@/lib/time/tz";
import {
  buttonSecondaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { EntryTable } from "./entry-table";
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
  // re-renders for the new anchor.
  const [optimisticDay, setOptimisticDay] = useState<string | null>(null);
  const visibleDay = optimisticDay ?? dayStr;

  // Drop optimistic state once props catch up
  useEffect(() => {
    if (optimisticDay && optimisticDay === dayStr) {
      setOptimisticDay(null);
    }
  }, [optimisticDay, dayStr]);

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

  const groups: EntryGroup<TimeEntry>[] = useMemo(
    () => [
      {
        id: "__day__",
        label: titleLabel,
        entries: [...trulyDayEntries].sort(
          (a, b) =>
            new Date(a.start_time).getTime() -
            new Date(b.start_time).getTime(),
        ),
        totalMin: trulyDayEntries.reduce(
          (s, e) => s + (e.duration_min ?? 0),
          0,
        ),
        billableMin: trulyDayEntries
          .filter((e) => e.billable)
          .reduce((s, e) => s + (e.duration_min ?? 0), 0),
      },
    ],
    [trulyDayEntries, titleLabel],
  );

  return (
    <div className="space-y-4">
      {/* Header: prev / title / next */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={goPrev}
          className={buttonSecondaryClass}
          aria-label={t("prevDay")}
        >
          <ChevronLeft size={16} />
          <kbd className={kbdClass}>←</kbd>
        </button>
        <h2 className="text-lg font-semibold text-content inline-flex items-center gap-2">
          {titleLabel}
          {isPending && (
            <Loader2 size={16} className="animate-spin text-content-muted" />
          )}
        </h2>
        <button
          type="button"
          onClick={goNext}
          className={buttonSecondaryClass}
          aria-label={t("nextDay")}
        >
          <kbd className={kbdClass}>→</kbd>
          <ChevronRight size={16} />
        </button>
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
                <span className="text-sm font-semibold mt-0.5">
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
            <span className="font-mono text-sm font-semibold tabular-nums text-content mt-0.5">
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
          hideGroupHeaders
          tzOffsetMin={tzOffsetMin}
        />
      </div>
    </div>
  );
}
