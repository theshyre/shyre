"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DollarSign, Minus } from "lucide-react";
import { formatDurationHM } from "@/lib/time/week";
import { EntryAuthor } from "@/components/EntryAuthor";
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
  tzOffsetMin?: number;
}

/**
 * A single <tr> in the entry table, plus an optional spanning edit row
 * rendered underneath it when `expanded` is true.
 *
 * Layout (category-first):
 *   [Category █ Name] [Project · Client — Description] [Duration] [$] [⋯]
 */
export function EntryRow({
  entry,
  projects,
  categories,
  expanded,
  onToggleExpand,
  columnCount,
  tzOffsetMin,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const isRunning = !entry.end_time;
  const projectName = entry.projects?.name ?? "—";
  const customerName = entry.projects?.customers?.name ?? null;
  const startDate = new Date(entry.start_time);
  const startTime = startDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const category = entry.category_id
    ? categories.find((c) => c.id === entry.category_id)
    : null;

  // Live-tick when running. Interval only binds while isRunning so we
  // don't burn cycles on every stopped row in the grid.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);
  const liveElapsed = (() => {
    const diff = Math.max(0, nowMs - startDate.getTime());
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  })();

  const rowClass = `border-b border-edge last:border-0 hover:bg-hover transition-colors cursor-pointer ${
    expanded ? "bg-surface-inset" : ""
  }`;

  return (
    <>
      <tr className={rowClass} onClick={() => onToggleExpand(entry.id)}>
        {/* Category — hero column */}
        <td className="py-2.5 align-middle">
          {category ? (
            <div className="flex items-center gap-2 border-l-4 pl-3" style={{ borderColor: category.color }}>
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: category.color }}
              />
              <span className="text-body font-semibold text-content">
                {category.name}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-l-4 border-edge pl-3">
              <span className="h-2.5 w-2.5 rounded-full bg-content-muted shrink-0" />
              <span className="text-body text-content-muted italic">
                {t("entry.noCategory")}
              </span>
            </div>
          )}
        </td>

        {/* Project · Client + Description */}
        <td className="px-3 py-2.5 align-middle min-w-0">
          <div className="text-caption text-content-secondary truncate">
            <span className="text-content">{projectName}</span>
            {customerName && (
              <span className="text-content-muted"> · {customerName}</span>
            )}
          </div>
          {entry.description ? (
            <div className="text-body text-content truncate mt-0.5">
              {entry.description}
            </div>
          ) : (
            <div className="text-body text-content-muted italic truncate mt-0.5">
              {t("entry.untitled")}
            </div>
          )}
        </td>

        {/* Author — per the MANDATORY authorship rule */}
        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
          <EntryAuthor author={entry.author} size={20} />
        </td>

        {/* Start time (small, muted) */}
        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-right">
          <span className="font-mono text-caption text-content-muted">
            {startTime}
          </span>
        </td>

        {/* Duration — live-ticks every second for running entries so the
            grid shows the elapsed clock, not a frozen "Running" label. */}
        <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-body-lg font-semibold text-success tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {liveElapsed}
            </span>
          ) : (
            <span className="font-mono text-body-lg font-semibold text-content tabular-nums">
              {formatDurationHM(entry.duration_min)}
            </span>
          )}
        </td>

        {/* Billable */}
        <td className="px-2 py-2.5 align-middle text-center whitespace-nowrap">
          {entry.billable ? (
            <DollarSign size={14} className="inline text-success" />
          ) : (
            <Minus size={14} className="inline text-content-muted" />
          )}
        </td>

        <td
          className="px-2 py-2.5 align-middle text-right"
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
              tzOffsetMin={tzOffsetMin}
            />
          </td>
        </tr>
      )}
    </>
  );
}
