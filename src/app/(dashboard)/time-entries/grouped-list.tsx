"use client";

import { useTranslations } from "next-intl";
import { formatDurationShort } from "@/lib/time/week";
import type { EntryGroup } from "@/lib/time/grouping";
import { EntryCard } from "./entry-card";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  groups: EntryGroup<TimeEntry>[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
}

export function GroupedList({
  groups,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
}: Props): React.JSX.Element {
  const t = useTranslations("time");

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-edge bg-surface-raised p-6 text-sm text-content-muted text-center">
        {t("noEntries")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div
          key={group.id}
          className="rounded-lg border border-edge bg-surface-raised overflow-hidden"
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-edge bg-surface-inset px-4 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {group.color && (
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <h3 className="text-sm font-semibold text-content truncate">
                {group.label}
              </h3>
              {group.sublabel && (
                <span className="text-xs text-content-muted">
                  {group.sublabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-mono text-content-secondary">
                {formatDurationShort(group.totalMin)}
              </span>
              {group.billableMin !== group.totalMin && (
                <span className="text-[10px] text-success">
                  {formatDurationShort(group.billableMin)} billable
                </span>
              )}
              <span className="text-[10px] text-content-muted">
                {group.entries.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-edge">
            {group.entries.map((entry) => (
              <div key={entry.id} className="p-2">
                <EntryCard
                  entry={entry}
                  projects={projects}
                  categories={categories}
                  expanded={expandedEntryId === entry.id}
                  onToggleExpand={onToggleExpand}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
