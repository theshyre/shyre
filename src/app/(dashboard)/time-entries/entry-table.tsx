"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDurationHM } from "@/lib/time/week";
import type { EntryGroup } from "@/lib/time/grouping";
import { EntryRow } from "./entry-row";
import { CustomerChip } from "@/components/CustomerChip";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { Tooltip } from "@/components/Tooltip";
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
  /** auth.uid() of the viewer — passed in from the server page so
   *  EntryRow can show the chip's refresh button only on the
   *  viewer's own entries (the action enforces this server-side). */
  viewerUserId?: string | null;
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
  viewerUserId = null,
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

  // Measure the header row's rendered height so the bulk-action strip can
  // overlay it pixel-perfectly. Text-size preference scales typography, so
  // the static "h-10" guess would drift at Compact / Large — ResizeObserver
  // tracks the real value.
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [theadHeight, setTheadHeight] = useState<number>(0);
  useEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const update = (): void => setTheadHeight(el.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // Escape clears an active selection. Only bound while someSelected so
  // we never swallow Escape when there's nothing to cancel out of.
  useEffect(() => {
    if (!someSelected) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setSelectedIds(new Set());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [someSelected]);

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
    <div className="relative rounded-lg border border-edge bg-surface-raised overflow-hidden">
      {/* table-fixed forces the browser to use the column widths declared
          on the <th>s — without it, table-auto layout respects the min-
          content width of the longest description cell, which pushes
          Member / Time / Duration / Billable clear off the visible area
          on any row with a verbose description (classic Harvest import
          pattern: "[$135/hr] Programming: Audit History CSV diff
          missing section-level N/A toggle and retains stale values
          after N/A is checked"). With table-fixed + truncate on the
          description cell, the text ellipsizes cleanly and every
          downstream column stays visible. */}
      <table className="w-full table-fixed text-body">
        {/* Column headers stay mounted at all times. When a selection is
            active the bulk strip overlays this row visually, but the
            <th> cells remain the authoritative source of column widths
            so toggling selection never shifts layout (vertical or
            horizontal). AT hears the toolbar instead of stale headers
            via aria-hidden. */}
        <thead
          ref={theadRef}
          className="bg-surface-inset"
          aria-hidden={someSelected || undefined}
        >
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
                tabIndex={someSelected ? -1 : 0}
                className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
              />
            </th>
            <th className="w-[192px] py-2 pr-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.category")}
            </th>
            <th className="px-3 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {/* No width — this column absorbs remaining space and
                  its cell content is truncated, not wrapped. */}
              {t("tableHeaders.projectDescription")}
            </th>
            <th className="w-[160px] px-3 py-2 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.member")}
            </th>
            <th className="w-[96px] px-3 py-2 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.time")}
            </th>
            <th className="w-[96px] px-3 py-2 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.duration")}
            </th>
            <th className="w-20 px-2 py-2 text-center text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("tableHeaders.billable")}
            </th>
            <th className="w-16 px-2 py-2" aria-label="actions" />
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
              tzOffsetMin={tzOffsetMin}
              selectedIds={selectedIds}
              onToggleSelect={toggleOne}
              viewerUserId={viewerUserId}
            />
          ))}
        </tbody>
      </table>
      {/* Bulk-action strip. Absolute-positioned over the header row so
          column widths stay owned by <th> cells; height is measured from
          the thead ref so Compact / Regular / Large text-size
          preferences all align. Same background as the thead, so the
          replacement reads as a mode change rather than a layout
          shift. */}
      {someSelected && (
        <div
          role="toolbar"
          aria-label={t("bulk.label")}
          className="absolute left-0 right-0 top-0 z-10 flex items-center gap-4 bg-surface-inset border-b border-edge px-4"
          style={theadHeight > 0 ? { height: theadHeight } : undefined}
        >
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
          <span className="text-body font-medium text-accent-text">
            {t("bulk.selectedCount", { count: selectedIds.size })}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-caption text-content-secondary hover:text-content hover:underline"
          >
            {t("bulk.clear")}
          </button>
          <div className="ml-auto">
            <Tooltip label={t("bulk.delete")}>
              <span style={{ display: "inline-flex" }}>
                <InlineDeleteRowConfirm
                  ariaLabel={t("bulk.delete")}
                  onConfirm={bulkDelete}
                  summary={tc("deleteCount", { count: selectedIds.size })}
                />
              </span>
            </Tooltip>
          </div>
        </div>
      )}
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
  viewerUserId,
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
  viewerUserId: string | null;
}): React.JSX.Element {
  // Customer-grouped variant: the group carries customer identity
  // (id, name, internal flag, rail color) so the header renders the
  // CustomerChip + name and each row inherits the rail. Mirrors the
  // CustomerSubHeader pattern from the week view so day and week
  // share one visual language for "this is a customer cluster."
  const isCustomerGroup =
    group.customerId !== undefined ||
    group.isInternalCustomer === true;
  const railColor = group.railColor ?? null;

  return (
    <>
      {showHeader && isCustomerGroup && (
        <tr className="bg-surface-inset/70 border-y border-edge-muted">
          <td
            className={`w-10 align-middle py-1.5 ${railColor ? "border-l-4 pl-3" : "pl-4"}`}
            style={railColor ? { borderLeftColor: railColor } : undefined}
            aria-hidden
          />
          <th
            scope="rowgroup"
            colSpan={4}
            className="px-3 py-1.5 text-left font-normal"
          >
            <div className="flex items-center gap-2 min-w-0">
              {group.customerId ? (
                <CustomerChip
                  customerId={group.customerId}
                  customerName={group.label}
                  size={18}
                />
              ) : group.isInternalCustomer ? (
                <CustomerChip
                  customerId={null}
                  customerName={null}
                  internal
                  size={18}
                />
              ) : (
                <CustomerChip
                  customerId={null}
                  customerName={null}
                  size={18}
                />
              )}
              <Tooltip label={group.label}>
                <span className="text-body-lg font-semibold text-content truncate min-w-0">
                  {group.label}
                </span>
              </Tooltip>
              <span className="text-caption text-content-muted ml-1">
                · {group.entries.length}
              </span>
            </div>
          </th>
          <td className="px-3 py-1.5 text-right">
            <span className="font-mono text-body font-semibold text-content tabular-nums">
              {formatDurationHM(group.totalMin)}
            </span>
          </td>
          <td className="px-2 py-1.5" colSpan={2} />
        </tr>
      )}
      {showHeader && !isCustomerGroup && (
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
          canRefresh={!!viewerUserId && viewerUserId === entry.user_id}
          customerRail={railColor}
        />
      ))}
    </>
  );
}
