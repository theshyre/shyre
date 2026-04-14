"use client";

import { useTranslations } from "next-intl";
import {
  formatDurationShort,
  isSameDay,
  sumDurationMin,
} from "@/lib/time/week";
import { EntryCard } from "./entry-card";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  date: Date;
  entries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
}

export function DayColumn({
  date,
  entries,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
}: Props): React.JSX.Element {
  const t = useTranslations("time.week");
  const isToday = isSameDay(date, new Date());
  const totalMin = sumDurationMin(entries);
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const dayNum = date.getDate();

  return (
    <div
      className={`rounded-lg border p-3 min-h-[120px] flex flex-col gap-2 ${
        isToday
          ? "border-accent/40 bg-accent-soft/30"
          : "border-edge bg-surface-raised"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
            {weekday}
          </p>
          <p className="text-lg font-semibold text-content">{dayNum}</p>
        </div>
        <p className="text-xs font-mono text-content-secondary">
          {formatDurationShort(totalMin)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {entries.length === 0 ? (
          <p className="text-xs text-content-muted italic">{t("emptyDay")}</p>
        ) : (
          entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              projects={projects}
              categories={categories}
              expanded={expandedEntryId === entry.id}
              onToggleExpand={onToggleExpand}
            />
          ))
        )}
      </div>
    </div>
  );
}
