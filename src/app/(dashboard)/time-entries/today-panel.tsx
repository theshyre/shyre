"use client";

import { useTranslations } from "next-intl";
import { Sun } from "lucide-react";
import { formatDurationShort, sumDurationMin } from "@/lib/time/week";
import { EntryCard } from "./entry-card";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  entries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
}

export function TodayPanel({
  entries,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
}: Props): React.JSX.Element {
  const t = useTranslations("time.home");
  const total = sumDurationMin(entries);

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sun size={18} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content">
            {t("todayTitle")}
          </h2>
        </div>
        <p className="text-xs font-mono text-content-secondary">
          {formatDurationShort(total)}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-content-muted">{t("noToday")}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              projects={projects}
              categories={categories}
              expanded={expandedEntryId === entry.id}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
