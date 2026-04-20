"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDurationHM } from "@/lib/time/week";
import type { EntryGroup } from "@/lib/time/grouping";
import { EntryRow } from "./entry-row";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { useToast } from "@/components/Toast";
import {
  deleteTimeEntriesAction,
  restoreTimeEntriesAction,
} from "./actions";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  groups: EntryGroup<TimeEntry>[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
  /** Hide the group headers when there's only one implicit group (e.g. today panel) */
  hideGroupHeaders?: boolean;
  tzOffsetMin?: number;
}

// Leading select column + 6 content columns + kebab column.
const COLUMN_COUNT = 8;

export function EntryTable({
  groups,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
  hideGroupHeaders,
  tzOffsetMin,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const tc = useTranslations("common.actions");
  const tToast = useTranslations("time.toast");
  const toast = useToast();

  // Multi-row selection for bulk delete. Keyed by entry id; cleared
  // after a bulk action commits or when the component unmounts.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const visibleEntries = useMemo(
    () => groups.flatMap((g) => g.entries),
    [groups],
  );
  const visibleIds = useMemo(
    () => visibleEntries.map((e) => e.id),
    [visibleEntries],
  );

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      // If any are selected, clear everything; otherwise select every
      // visible id. Matches the classic "master checkbox" behaviour.
      if (prev.size > 0) return new Set();
      return new Set(visibleIds);
    });
  }, [visibleIds]);

  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    await deleteTimeEntriesAction(fd);
    setSelectedIds(new Set());
    toast.push({
      kind: "info",
      message: tToast("entriesDeleted", { count: ids.length }),
      actionLabel: tToast("undo"),
      onAction: async () => {
        const restoreFd = new FormData();
        for (const id of ids) restoreFd.append("id", id);
        await restoreTimeEntriesAction(restoreFd);
      },
    });
  }, [selectedIds, toast, tToast]);

  if (groups.length === 0 || groups.every((g) => g.entries.length === 0)) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center text-body text-content-muted">
        {t("noEntries")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-raised overflow-hidden">
      <table className="w-full text-body">
        <thead className="bg-surface-inset">
          {someSelected ? (
            /* Gmail-style toolbar: the header row's content swaps when
               a selection is active. Row height stays the same, so
               toggling selection never shifts the table. */
            <tr role="toolbar" aria-label={t("bulk.label")}>
              <th className="w-10 pl-4 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label={t("bulk.selectAll")}
                  className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
                />
              </th>
              <th
                colSpan={6}
                className="py-2 text-left text-body font-medium text-accent-text"
              >
                <span>{t("bulk.selectedCount", { count: selectedIds.size })}</span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-4 text-caption text-content-secondary hover:text-content hover:underline"
                >
                  {t("bulk.clear")}
                </button>
              </th>
              <th className="px-2 py-1 text-right">
                <InlineDeleteRowConfirm
                  ariaLabel={t("bulk.delete")}
                  onConfirm={bulkDelete}
                  summary={tc("deleteCount", { count: selectedIds.size })}
                />
              </th>
            </tr>
          ) : (
            <tr>
              <th className="w-10 pl-4 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label={t("bulk.selectAll")}
                  className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
                />
              </th>
              <th className="py-2 pr-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("tableHeaders.category")}
              </th>
              <th className="px-3 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("tableHeaders.projectDescription")}
              </th>
              <th className="px-3 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("tableHeaders.member")}
              </th>
              <th className="px-3 py-2 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("tableHeaders.time")}
              </th>
              <th className="px-3 py-2 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("tableHeaders.duration")}
              </th>
              <th className="px-2 py-2 text-center text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("tableHeaders.billable")}
              </th>
              <th className="px-2 py-2" aria-label="actions" />
            </tr>
          )}
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupBlock
              key={group.id}
              group={group}
              projects={projects}
              categories={categories}
              expandedEntryId={expandedEntryId}
              onToggleExpand={onToggleExpand}
              showHeader={!hideGroupHeaders}
              tzOffsetMin={tzOffsetMin}
              selectedIds={selectedIds}
              onToggleSelect={toggleOne}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({
  group,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
  showHeader,
  tzOffsetMin,
  selectedIds,
  onToggleSelect,
}: {
  group: EntryGroup<TimeEntry>;
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
  showHeader: boolean;
  tzOffsetMin?: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {showHeader && (
        <tr className="bg-surface-inset/60 border-y border-edge">
          <td className="pl-4 py-1.5 w-10" aria-hidden />
          <td colSpan={4} className="px-3 py-1.5">
            <div className="flex items-center gap-2">
              {group.color && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span className="text-label font-semibold uppercase tracking-wider text-content">
                {group.label}
              </span>
              {group.sublabel && (
                <span className="text-label text-content-muted">
                  · {group.sublabel}
                </span>
              )}
              <span className="text-label text-content-muted">
                · {group.entries.length}
              </span>
            </div>
          </td>
          <td className="px-3 py-1.5 text-right">
            <span className="font-mono text-caption font-semibold text-content tabular-nums">
              {formatDurationHM(group.totalMin)}
            </span>
          </td>
          <td className="px-2 py-1.5" colSpan={2} />
        </tr>
      )}
      {group.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          projects={projects}
          categories={categories}
          expanded={expandedEntryId === entry.id}
          onToggleExpand={onToggleExpand}
          columnCount={COLUMN_COUNT}
          tzOffsetMin={tzOffsetMin}
          selected={selectedIds.has(entry.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </>
  );
}
