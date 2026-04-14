"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Sun } from "lucide-react";
import {
  formatDurationHM,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import type { EntryGroup } from "@/lib/time/grouping";
import { EntryTable } from "./entry-table";
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
  const billable = sumBillableMin(entries);

  // Wrap today's entries in a single unnamed group so we reuse EntryTable.
  const groups: EntryGroup<TimeEntry>[] = useMemo(
    () => [
      {
        id: "__today__",
        label: "Today",
        entries: [...entries].sort(
          (a, b) =>
            new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
        ),
        totalMin: total,
        billableMin: billable,
      },
    ],
    [entries, total, billable],
  );

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sun size={16} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content">
            {t("todayTitle")}
          </h2>
        </div>
        {entries.length > 0 && (
          <p className="font-mono text-xs text-content-secondary tabular-nums">
            {formatDurationHM(total)}
          </p>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-4 text-sm text-content-muted">
          {t("noToday")}
        </p>
      ) : (
        <EntryTable
          groups={groups}
          projects={projects}
          categories={categories}
          expandedEntryId={expandedEntryId}
          onToggleExpand={onToggleExpand}
          hideGroupHeaders
        />
      )}
    </section>
  );
}
