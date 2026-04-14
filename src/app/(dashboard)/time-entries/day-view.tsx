"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  formatDurationHMZero,
  isSameDay,
} from "@/lib/time/week";
import {
  buttonSecondaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { EntryTable } from "./entry-table";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";
import type { EntryGroup } from "@/lib/time/grouping";

interface Props {
  /** The day being viewed */
  day: Date;
  /** Start of the week the day is in — for the 7-day strip at the top */
  weekStart: Date;
  /** Entries for the *entire week*, used for daily-total strip */
  weekEntries: TimeEntry[];
  /** Entries for the specific day */
  dayEntries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
}

export function DayView({
  day,
  weekStart,
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
  // re-renders the page for the new anchor.
  const [optimisticDay, setOptimisticDay] = useState<Date | null>(null);
  const visibleDay = optimisticDay ?? day;

  // Reset optimistic day when props catch up
  useEffect(() => {
    if (optimisticDay && isSameDay(optimisticDay, day)) {
      setOptimisticDay(null);
    }
  }, [optimisticDay, day]);

  // Daily totals per day of this week
  const dailyTotals = useMemo(() => {
    const totals = Array.from({ length: 7 }, () => 0);
    for (const e of weekEntries) {
      const start = new Date(e.start_time);
      const diff = Math.round(
        (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
          new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (diff >= 0 && diff < 7) {
        totals[diff] = (totals[diff] ?? 0) + (e.duration_min ?? 0);
      }
    }
    return totals;
  }, [weekEntries, weekStart]);

  const weekTotal = dailyTotals.reduce((s, n) => s + n, 0);

  const navigateToDay = useCallback(
    (targetDay: Date) => {
      if (isSameDay(targetDay, visibleDay)) return;
      // Optimistic update — highlight the new day immediately
      setOptimisticDay(targetDay);
      const params = new URLSearchParams(searchParams.toString());
      params.set("anchor", toIsoDate(targetDay));
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams, visibleDay],
  );

  const goPrev = useCallback(() => {
    const d = new Date(visibleDay);
    d.setDate(d.getDate() - 1);
    navigateToDay(d);
  }, [visibleDay, navigateToDay]);

  const goNext = useCallback(() => {
    const d = new Date(visibleDay);
    d.setDate(d.getDate() + 1);
    navigateToDay(d);
  }, [visibleDay, navigateToDay]);

  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: goPrev });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: goNext });

  const today = new Date();
  const isToday = isSameDay(visibleDay, today);
  const titleLabel = isToday
    ? t("today", {
        date: visibleDay.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        }),
      })
    : visibleDay.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year:
          visibleDay.getFullYear() !== today.getFullYear()
            ? "numeric"
            : undefined,
      });

  // Filter dayEntries client-side too, as a safety net: only show entries whose
  // local calendar date matches the currently-visible day. This defends
  // against any timezone edge case where the server query included a bordering
  // entry, and also handles the "optimistic day" state before the server
  // returns the new query.
  const trulyDayEntries = useMemo(() => {
    return dayEntries.filter((e) => {
      const s = new Date(e.start_time);
      return (
        s.getFullYear() === visibleDay.getFullYear() &&
        s.getMonth() === visibleDay.getMonth() &&
        s.getDate() === visibleDay.getDate()
      );
    });
  }, [dayEntries, visibleDay]);

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
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const isCurrent = isSameDay(d, visibleDay);
            const isTodayPill = isSameDay(d, today);
            const tot = dailyTotals[i] ?? 0;
            return (
              <button
                key={i}
                type="button"
                onClick={() => navigateToDay(d)}
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
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="text-sm font-semibold mt-0.5">
                  {d.getDate()}
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

      {/* Entries for this day — dimmed while transitioning */}
      <div className={isPending ? "opacity-60 transition-opacity" : ""}>
        <EntryTable
          groups={groups}
          projects={projects}
          categories={categories}
          expandedEntryId={expandedEntryId}
          onToggleExpand={toggleExpanded}
          hideGroupHeaders
        />
      </div>
    </div>
  );
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
