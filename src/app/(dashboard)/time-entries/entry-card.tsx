"use client";

import { useTranslations } from "next-intl";
import { DollarSign } from "lucide-react";
import { formatDurationShort } from "@/lib/time/week";
import { EntryKebabMenu } from "./entry-kebab-menu";
import { InlineEditForm } from "./inline-edit-form";
import { CategoryBadge } from "./category-picker";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  entry: TimeEntry;
  projects: ProjectOption[];
  categories: CategoryOption[];
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}

export function EntryCard({
  entry,
  projects,
  categories,
  expanded,
  onToggleExpand,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const tt = useTranslations("time.timer");
  const isRunning = !entry.end_time;
  const projectName = entry.projects?.name ?? "—";
  const startTime = new Date(entry.start_time).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const entryCategory = entry.category_id
    ? categories.find((c) => c.id === entry.category_id)
    : null;

  return (
    <div
      className={`rounded-md border text-left transition-colors ${
        expanded
          ? "border-accent bg-surface-raised"
          : "border-edge bg-surface-inset hover:border-content-muted"
      }`}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => onToggleExpand(entry.id)}
          aria-expanded={expanded}
          className="flex-1 px-2 py-2 text-left"
        >
          <p className="text-xs font-medium text-content truncate">
            {projectName}
          </p>
          {entry.description && (
            <p className="text-xs text-content-secondary truncate">
              {entry.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] font-mono text-content-muted">
              {startTime}
            </span>
            {isRunning ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {tt("running")}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-content-secondary">
                {formatDurationShort(entry.duration_min)}
              </span>
            )}
            {entry.billable && (
              <DollarSign size={10} className="text-success" />
            )}
            {entryCategory && <CategoryBadge category={entryCategory} />}
          </div>
        </button>
        <div className="pr-1 pt-1">
          <EntryKebabMenu
            entry={entry}
            onEdit={() => onToggleExpand(entry.id)}
          />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-edge p-3">
          <InlineEditForm
            entry={entry}
            projects={projects}
            categories={categories}
            onDone={() => onToggleExpand(entry.id)}
          />
        </div>
      )}
    </div>
  );
}
