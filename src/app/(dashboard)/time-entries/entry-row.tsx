"use client";

import { useTranslations } from "next-intl";
import { DollarSign, Minus } from "lucide-react";
import { formatDurationHM } from "@/lib/time/week";
import { EntryKebabMenu } from "./entry-kebab-menu";
import { InlineEditForm } from "./inline-edit-form";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  entry: TimeEntry;
  projects: ProjectOption[];
  categories: CategoryOption[];
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  /** Total number of columns in the parent table — used for the edit row span */
  columnCount: number;
}

/**
 * A single <tr> in the entry table, plus an optional spanning edit row
 * rendered underneath it when `expanded` is true.
 */
export function EntryRow({
  entry,
  projects,
  categories,
  expanded,
  onToggleExpand,
  columnCount,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const tt = useTranslations("time.timer");
  const isRunning = !entry.end_time;
  const projectName = entry.projects?.name ?? "—";
  const startDate = new Date(entry.start_time);
  const startTime = startDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const category = entry.category_id
    ? categories.find((c) => c.id === entry.category_id)
    : null;

  const rowClass = `border-b border-edge last:border-0 hover:bg-hover transition-colors cursor-pointer ${
    expanded ? "bg-surface-inset" : ""
  }`;

  return (
    <>
      <tr className={rowClass} onClick={() => onToggleExpand(entry.id)}>
        <td className="px-3 py-2 align-middle whitespace-nowrap">
          <span className="font-mono text-xs text-content-secondary">
            {startTime}
          </span>
        </td>
        <td className="px-3 py-2 align-middle">
          <span className="text-sm text-content">{projectName}</span>
        </td>
        <td className="px-3 py-2 align-middle">
          <span className="text-sm text-content-secondary">
            {entry.description || (
              <span className="text-content-muted italic">
                {t("entry.untitled")}
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-2 align-middle whitespace-nowrap">
          {category ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: category.color }}
              />
              <span className="text-content-secondary">{category.name}</span>
            </span>
          ) : (
            <span className="text-xs text-content-muted">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-middle text-right whitespace-nowrap">
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {tt("running")}
            </span>
          ) : (
            <span className="font-mono text-sm font-semibold text-content tabular-nums">
              {formatDurationHM(entry.duration_min)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 align-middle text-center whitespace-nowrap">
          {entry.billable ? (
            <DollarSign size={14} className="inline text-success" />
          ) : (
            <Minus size={14} className="inline text-content-muted" />
          )}
        </td>
        <td
          className="px-2 py-2 align-middle text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <EntryKebabMenu entry={entry} onEdit={() => onToggleExpand(entry.id)} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface-inset">
          <td
            colSpan={columnCount}
            className="px-4 py-3 border-b border-edge"
            onClick={(e) => e.stopPropagation()}
          >
            <InlineEditForm
              entry={entry}
              projects={projects}
              categories={categories}
              onDone={() => onToggleExpand(entry.id)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
