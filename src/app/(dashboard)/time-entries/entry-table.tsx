"use client";

import { useTranslations } from "next-intl";
import { formatDurationHM } from "@/lib/time/week";
import type { EntryGroup } from "@/lib/time/grouping";
import { EntryRow } from "./entry-row";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  groups: EntryGroup<TimeEntry>[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
  /** Hide the group headers when there's only one implicit group (e.g. today panel) */
  hideGroupHeaders?: boolean;
}

const COLUMN_COUNT = 7;

export function EntryTable({
  groups,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
  hideGroupHeaders,
}: Props): React.JSX.Element {
  const t = useTranslations("time");

  if (groups.length === 0 || groups.every((g) => g.entries.length === 0)) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center text-sm text-content-muted">
        {t("noEntries")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-raised overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-inset">
          <tr>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.time")}
            </th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.project")}
            </th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.description")}
            </th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.category")}
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.duration")}
            </th>
            <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.billable")}
            </th>
            <th className="px-2 py-2" aria-label="actions" />
          </tr>
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
}: {
  group: EntryGroup<TimeEntry>;
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
  showHeader: boolean;
}): React.JSX.Element {
  return (
    <>
      {showHeader && (
        <tr className="bg-surface-inset/60 border-y border-edge">
          <td colSpan={5} className="px-3 py-1.5">
            <div className="flex items-center gap-2">
              {group.color && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span className="text-xs font-semibold uppercase tracking-wider text-content">
                {group.label}
              </span>
              {group.sublabel && (
                <span className="text-[10px] text-content-muted">
                  · {group.sublabel}
                </span>
              )}
              <span className="text-[10px] text-content-muted">
                · {group.entries.length}
              </span>
            </div>
          </td>
          <td className="px-3 py-1.5 text-right">
            <span className="font-mono text-xs font-semibold text-content tabular-nums">
              {formatDurationHM(group.totalMin)}
            </span>
          </td>
          <td className="px-2 py-1.5" />
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
        />
      ))}
    </>
  );
}
