"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Trash2, X } from "lucide-react";
import { formatDurationHM } from "@/lib/time/week";
import type { EntryGroup } from "@/lib/time/grouping";
import { EntryRow } from "./entry-row";
import { CustomerChip } from "@/components/CustomerChip";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import {
  deleteTimeEntriesAction,
  markBilledElsewhereEntriesAction,
  restoreTimeEntriesAction,
  unmarkBilledElsewhereEntriesAction,
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
  /** Forwarded to every EntryRow. Enable in views that don't convey
   *  a row's date through structure (i.e. the flat Table view).
   *  Default false. */
  showDate?: boolean;
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
  showDate = false,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
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

  const bulkMarkBilledElsewhere = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    await markBilledElsewhereEntriesAction(fd);
    setSelectedIds(new Set());
    toast.push({
      kind: "info",
      message: tToast("entriesMarkedBilledElsewhere", { count: ids.length }),
      actionLabel: tToast("undo"),
      onAction: async () => {
        const undoFd = new FormData();
        for (const id of ids) undoFd.append("id", id);
        await unmarkBilledElsewhereEntriesAction(undoFd);
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
              showDate={showDate}
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
          <div className="ml-auto flex items-center gap-2">
            <InlineMarkBilledElsewhereButton
              count={selectedIds.size}
              onConfirm={bulkMarkBilledElsewhere}
            />
            <InlineBulkDeleteButton
              count={selectedIds.size}
              onConfirm={bulkDelete}
            />
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
  showDate = false,
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
  showDate?: boolean;
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
          showDate={showDate}
        />
      ))}
    </>
  );
}

/**
 * Inline two-step confirm for "Mark as billed elsewhere." Sits in the
 * bulk-action strip alongside the typed-delete control. Tier-1 inline
 * confirm (no typed word) because the operation is fully reversible
 * via the Undo toast and doesn't destroy data — typed-delete would be
 * over-protection. Two-state UI: idle icon button → expanded
 * "Confirm? [Mark][X]" cluster. Escape collapses while focus is
 * inside the cluster.
 */
function InlineMarkBilledElsewhereButton({
  count,
  onConfirm,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
}): React.JSX.Element {
  const t = useTranslations("time.bulk");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function fire(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Tooltip label={t("markBilledElsewhereTooltip")}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("markBilledElsewhere")}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1 text-caption font-medium text-content hover:bg-hover transition-colors"
        >
          <BadgeCheck size={14} aria-hidden="true" />
          <span>{t("markBilledElsewhere")}</span>
        </button>
      </Tooltip>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("markBilledElsewhere")}
      className="inline-flex items-center gap-2 rounded-md border border-edge bg-surface-raised px-2 py-1"
    >
      <span className="text-caption text-content whitespace-nowrap">
        {t("markBilledElsewhereConfirm", { count })}
      </span>
      <button
        type="button"
        onClick={() => void fire()}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-0.5 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        <BadgeCheck size={12} aria-hidden="true" />
        {t("markBilledElsewhereConfirmCta")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={pending}
        aria-label={t("markBilledElsewhereCancel")}
        className="rounded p-0.5 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * Inline typed-delete confirm for the bulk-action strip. A labeled
 * variant of `InlineDeleteRowConfirm` — the @theshyre/ui primitive's
 * icon-only idle state is right for row-level deletes (visual weight
 * matches the action scope: one row) but reads as too quiet for a
 * bulk strip on N entries. This wraps the typed-delete escalation
 * (text input + armed red button) behind a labeled trigger button
 * so the destructive affordance is proportional to the impact.
 *
 * Two-state UI:
 *   idle    → [Trash] Delete (labeled button)
 *   armed   → "Type delete to delete N entries [input] [Delete] [X]"
 *
 * `delete` typed into the input arms the red CTA. Escape collapses.
 */
function InlineBulkDeleteButton({
  count,
  onConfirm,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
}): React.JSX.Element {
  const t = useTranslations("time.bulk");
  const tCommon = useTranslations("common.actions");
  const tRow = useTranslations("time.rowDelete");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setOpen(false);
        setTyped("");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const canConfirm = typed.trim().toLowerCase() === "delete";

  async function fire(): Promise<void> {
    if (!canConfirm || pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
      setTyped("");
    }
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && canConfirm && !pending) {
      e.preventDefault();
      void fire();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("delete")}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1 text-caption font-medium text-error hover:bg-hover hover:text-error-text transition-colors"
      >
        <Trash2 size={14} aria-hidden="true" />
        <span>{tCommon("delete")}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("delete")}
      className="inline-flex items-center gap-2 rounded-md border border-error/40 bg-error-soft px-2 py-1"
    >
      <span className="text-caption text-content whitespace-nowrap">
        {tRow("promptWithSummary", {
          word: "delete",
          summary: tCommon("deleteCount", { count }),
        })}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={handleInputKey}
        aria-label={tRow("inputLabel")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-20 rounded border border-edge bg-surface-raised px-1.5 py-0.5 text-caption font-mono outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
      />
      <button
        type="button"
        onClick={() => void fire()}
        disabled={!canConfirm || pending}
        aria-label={tCommon("confirmDelete")}
        className="inline-flex items-center gap-1 rounded bg-error px-2.5 py-0.5 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        <Trash2 size={12} aria-hidden="true" />
        {tCommon("delete")}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTyped("");
        }}
        disabled={pending}
        aria-label={tCommon("cancel")}
        className="rounded p-0.5 text-content-muted hover:bg-hover transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
