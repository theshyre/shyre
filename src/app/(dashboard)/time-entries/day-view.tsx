"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  /** Entries for the specific day (may overlap with weekEntries) */
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
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedEntryId((c) => (c === id ? null : id));
  }, []);

  // Daily totals for each day of this week
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
      const params = new URLSearchParams(searchParams.toString());
      params.set("anchor", toIsoDate(targetDay));
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const goPrev = useCallback(() => {
    const d = new Date(day);
    d.setDate(d.getDate() - 1);
    navigateToDay(d);
  }, [day, navigateToDay]);

  const goNext = useCallback(() => {
    const d = new Date(day);
    d.setDate(d.getDate() + 1);
    navigateToDay(d);
  }, [day, navigateToDay]);

  useKeyboardShortcut({ key: "ArrowLeft", onTrigger: goPrev });
  useKeyboardShortcut({ key: "ArrowRight", onTrigger: goNext });

  const isToday = isSameDay(day, new Date());
  const titleLabel = isToday
    ? t("today", {
        date: day.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        }),
      })
    : day.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year:
          day.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      });

  const groups: EntryGroup<TimeEntry>[] = useMemo(
    () => [
      {
        id: "__day__",
        label: titleLabel,
        entries: [...dayEntries].sort(
          (a, b) =>
            new Date(a.start_time).getTime() -
            new Date(b.start_time).getTime(),
        ),
        totalMin: dayEntries.reduce((s, e) => s + (e.duration_min ?? 0), 0),
        billableMin: dayEntries
          .filter((e) => e.billable)
          .reduce((s, e) => s + (e.duration_min ?? 0), 0),
      },
    ],
    [dayEntries, titleLabel],
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
        <h2 className="text-lg font-semibold text-content">{titleLabel}</h2>
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
      <div className="rounded-lg border border-edge bg-surface-raised p-3">
        <div className="grid grid-cols-8 gap-2 items-center">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const isCurrent = isSameDay(d, day);
            const tot = dailyTotals[i] ?? 0;
            return (
              <button
                key={i}
                type="button"
                onClick={() => navigateToDay(d)}
                className={`flex flex-col items-center py-1.5 rounded-md transition-colors ${
                  isCurrent
                    ? "bg-accent-soft text-accent-text"
                    : "hover:bg-hover text-content-secondary"
                }`}
              >
                <span className="text-[10px] font-semibold uppercase">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="font-mono text-xs tabular-nums mt-0.5">
                  {formatDurationHMZero(tot)}
                </span>
              </button>
            );
          })}
          <div className="flex flex-col items-end border-l border-edge pl-2">
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
      <EntryTable
        groups={groups}
        projects={projects}
        categories={categories}
        expandedEntryId={expandedEntryId}
        onToggleExpand={toggleExpanded}
        hideGroupHeaders
      />
    </div>
  );
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
