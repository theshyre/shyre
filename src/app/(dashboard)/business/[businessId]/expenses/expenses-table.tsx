"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { useToast } from "@/components/Toast";
import { Tooltip } from "@/components/Tooltip";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { assertActionResult } from "@/lib/action-result";
import {
  bulkDeleteExpensesAction,
  bulkRestoreExpensesAction,
  bulkUpdateExpenseBillableAction,
  bulkUpdateExpenseCategoryAction,
  bulkUpdateExpenseProjectAction,
} from "./actions";
import { ExpenseRow, type ExpenseAuthor } from "./expense-row";
import {
  BulkBillablePicker,
  BulkCategoryPicker,
  BulkProjectPicker,
} from "./bulk-pickers";
import type { ProjectOption } from "./page";
import type { ExpenseFilters } from "./filter-params";
import { appendFilterParams } from "./filter-formdata";

interface ExpenseRecord {
  id: string;
  team_id: string;
  user_id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string;
  description: string | null;
  notes: string | null;
  project_id: string | null;
  billable: boolean;
  is_sample: boolean;
  projects: { id: string; name: string } | null;
}

interface Props {
  expenses: ExpenseRecord[];
  projects: ProjectOption[];
  /** Maps each expense's user_id → author for avatar / name rendering. */
  authorById: Map<string, ExpenseAuthor>;
  teamRoleById: Map<string, string>;
  teamNameById: Map<string, string>;
  showTeamColumn: boolean;
  viewerUserId: string | null;
  /** Total expense count for the business across all years (no
   *  filter applied) — used in the bulk-strip "N of M expenses
   *  selected" label so the user can tell whether bulk applies
   *  to the filtered set or the whole business. */
  totalCount: number;
  /** Whether any filter is active. When true the bulk strip says
   *  "N of {filtered} filtered expenses selected"; when false it
   *  says "N of {total} expenses selected". */
  hasFilter: boolean;
  /** Server-side count of rows matching the current filter (before
   *  pagination clips). Drives the Gmail two-step "Select all N
   *  matching" banner that appears when the user has selected
   *  every loaded row but more rows match the filter than were
   *  loaded. */
  matchingCount: number;
  /** Active filter spec — passed to bulk actions when the user
   *  invokes "Select all matching" so the action runs against the
   *  same row universe the user sees. */
  filters: ExpenseFilters;
  /** Business id for filter-scope bulk actions. The action
   *  re-derives accessible team_ids from this + the caller's
   *  team_members rows under RLS. */
  businessId: string;
}

/**
 * Multi-select expenses table. Mirrors the time-entries pattern:
 * column headers stay mounted, bulk-action strip overlays the
 * <thead> via absolute positioning + ResizeObserver-measured
 * height, zero CLS on selection toggle, Escape clears selection,
 * destructive bulk uses `<InlineDeleteRowConfirm />` + Undo toast.
 *
 * Cell-level inline editing is delegated to ExpenseRow via
 * EditableCell — the toolbar above operates on whole rows
 * (delete, set category for all selected, set project for all
 * selected).
 */
export function ExpensesTable({
  expenses,
  projects,
  authorById,
  teamRoleById,
  teamNameById,
  showTeamColumn,
  viewerUserId,
  totalCount,
  hasFilter,
  matchingCount,
  filters,
  businessId,
}: Props): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const tToast = useTranslations("expenses.toast");
  const toast = useToast();
  // Total <th> count: select, date, amount, category, [team?], vendor,
  // description, notes, project, author, actions = 10 (+1 with team).
  // The expanded-row spans this many columns.
  const columnCount = showTeamColumn ? 11 : 10;

  // Inline-row expansion is purely client state — toggling does not
  // need to round-trip to the server. We seed from `?edit=<id>` on
  // mount (so deep links land already-expanded), then drive subsequent
  // toggles via React state and a `history.replaceState` shadow so the
  // URL stays shareable without triggering Next's server-component
  // re-render. Using `router.push` here added a ~2s click-to-expand
  // delay that this lift-to-state pattern eliminates.
  const initialEditId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("edit");
  }, []);
  const [expandedId, setExpandedId] = useState<string | null>(initialEditId);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => {
      const next = prev === id ? null : id;
      // Mirror to the URL without going through Next's router so we
      // skip the server-component re-render. Replace (not push) so
      // the back button doesn't accumulate one entry per row toggle.
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (next === null) params.delete("edit");
        else params.set("edit", next);
        const qs = params.toString();
        const url = qs
          ? `${window.location.pathname}?${qs}`
          : window.location.pathname;
        window.history.replaceState({}, "", url);
      }
      return next;
    });
  }, []);

  // Selection state — id-keyed Set so toggling is O(1) and
  // selection survives re-renders triggered by an in-cell save
  // (cell save → re-fetch → expenses prop changes → component
  // re-renders, selection persists because state is local).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Gmail two-step: when the user selects every loaded row AND
  // more rows match the filter than were loaded (paginated), the
  // strip surfaces "Select all N matching" — clicking it flips
  // this flag, which makes bulk actions send `scope=filters` so
  // the server re-runs the same filter and operates on every
  // matching row, not just the loaded ids.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  // Inline ack message rendered in the toolbar (where the
  // user's eye lives during a bulk action) for ~3s after a
  // successful bulk update. Toast at viewport bottom is the
  // persistent record; this is the in-place signal.
  const [bulkAckMessage, setBulkAckMessage] = useState<string | null>(null);
  const ackTimerRef = useRef<number | null>(null);
  const flashAck = useCallback((msg: string): void => {
    setBulkAckMessage(msg);
    if (ackTimerRef.current !== null) {
      window.clearTimeout(ackTimerRef.current);
    }
    ackTimerRef.current = window.setTimeout(() => {
      setBulkAckMessage(null);
      ackTimerRef.current = null;
    }, 3_000);
  }, []);
  useEffect(
    () => () => {
      if (ackTimerRef.current !== null) {
        window.clearTimeout(ackTimerRef.current);
      }
    },
    [],
  );

  const visibleIds = useMemo(
    () => expenses.map((e) => e.id),
    [expenses],
  );
  const allLoadedSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 || selectAllMatching;
  // Pagination active = matching rows server-side > loaded rows.
  // Drives the Gmail "Select all N matching" CTA visibility.
  const paginated = matchingCount > expenses.length;

  const toggleOne = useCallback(
    (id: string): void => {
      // Toggling an individual row exits matching mode and reverts
      // to id-list selection. Otherwise the row would visually
      // toggle while the strip still claimed "all matching" — a
      // lie. Drop matching mode + restart from the visible-row
      // selection minus the toggled id.
      if (selectAllMatching) {
        setSelectAllMatching(false);
        setSelectedIds(new Set(visibleIds.filter((vId) => vId !== id)));
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [selectAllMatching, visibleIds],
  );

  const toggleAll = useCallback((): void => {
    // Master checkbox always operates on the visible/loaded set.
    // The Gmail "Select all N matching" banner appears separately
    // after every visible row is selected — a deliberate two-step
    // so cross-page bulk requires explicit opt-in.
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds((prev) => {
      if (prev.size > 0) return new Set();
      return new Set(visibleIds);
    });
  }, [selectAllMatching, visibleIds]);

  const clearSelection = useCallback((): void => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, []);

  const enableSelectAllMatching = useCallback((): void => {
    setSelectAllMatching(true);
  }, []);

  // Escape clears an active selection. Only bound while
  // someSelected so we never swallow Escape on idle pages.
  useEffect(() => {
    if (!someSelected) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        setSelectAllMatching(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [someSelected]);

  // ── Bulk action handlers ────────────────────────────────────

  const bulkDelete = useCallback(async () => {
    // Branch on selectAllMatching: in matching mode the action
    // operates on every row matching the filter (server-side
    // re-resolution); otherwise on the explicit id list. Undo
    // toast always uses the resolved id list returned from the
    // delete — but we don't have that yet at the action layer
    // (it returns ActionResult, not data). For now: matching-mode
    // delete doesn't expose an Undo (the user opted into a bulk
    // operation across pages — the Trash surface is the recovery
    // path). Id-mode delete keeps the existing Undo.
    if (selectAllMatching) {
      const fd = new FormData();
      fd.set("scope", "filters");
      fd.set("businessId", businessId);
      appendFilterParams(fd, filters);
      await assertActionResult(bulkDeleteExpensesAction(fd));
      setSelectedIds(new Set());
      setSelectAllMatching(false);
      toast.push({
        kind: "info",
        message: tToast("bulkDeleted", { count: matchingCount }),
        durationMs: 10_000,
      });
      return;
    }

    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    await bulkDeleteExpensesAction(fd);
    setSelectedIds(new Set());
    toast.push({
      kind: "info",
      message: tToast("bulkDeleted", { count: ids.length }),
      actionLabel: tToast("undo"),
      durationMs: 10_000,
      onAction: async () => {
        const restoreFd = new FormData();
        for (const id of ids) restoreFd.append("id", id);
        await bulkRestoreExpensesAction(restoreFd);
      },
    });
  }, [
    selectAllMatching,
    selectedIds,
    matchingCount,
    filters,
    businessId,
    toast,
    tToast,
  ]);

  // INTENTIONAL: bulkSetCategory and bulkSetProject do NOT clear
  // the selection on success. Two reasons:
  //   1. The user often wants to apply BOTH category AND project
  //      to the same selected rows in sequence — clearing forces
  //      them to re-select between actions.
  //   2. Clearing selection mid-action also clears `someSelected`
  //      → the bulk toolbar unmounts → the picker (which was
  //      mid-flight, about to render its ✓ Done state) is
  //      destroyed before the user sees that feedback.
  // Bulk DELETE still clears (the rows are gone, can't operate on
  // them again). Users who want to clear the selection manually
  // can hit Escape or click "Clear selection" in the toolbar.

  const bulkSetCategory = useCallback(
    async (category: string): Promise<void> => {
      const fd = new FormData();
      fd.set("category", category);
      let count: number;
      if (selectAllMatching) {
        fd.set("scope", "filters");
        fd.set("businessId", businessId);
        appendFilterParams(fd, filters);
        count = matchingCount;
      } else {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        for (const id of ids) fd.append("id", id);
        count = ids.length;
      }
      const result = await bulkUpdateExpenseCategoryAction(fd);
      // runSafeAction returns ActionResult — null/undefined for
      // legacy void actions, { success } for the wrapped path.
      if (result && "success" in result && !result.success) {
        toast.push({
          kind: "error",
          message: result.error.userMessageKey,
        });
        throw new Error(result.error.userMessageKey);
      }
      const message = tToast("bulkCategorized", { count });
      flashAck(message);
      toast.push({ kind: "success", message });
    },
    [
      selectAllMatching,
      selectedIds,
      matchingCount,
      filters,
      businessId,
      toast,
      tToast,
      flashAck,
    ],
  );

  const bulkSetProject = useCallback(
    async (projectId: string): Promise<void> => {
      const fd = new FormData();
      fd.set("project_id", projectId);
      let count: number;
      if (selectAllMatching) {
        fd.set("scope", "filters");
        fd.set("businessId", businessId);
        appendFilterParams(fd, filters);
        count = matchingCount;
      } else {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        for (const id of ids) fd.append("id", id);
        count = ids.length;
      }
      const result = await bulkUpdateExpenseProjectAction(fd);
      if (result && "success" in result && !result.success) {
        toast.push({
          kind: "error",
          message: result.error.userMessageKey,
        });
        throw new Error(result.error.userMessageKey);
      }
      const message = tToast("bulkProjectAssigned", { count });
      flashAck(message);
      toast.push({ kind: "success", message });
    },
    [
      selectAllMatching,
      selectedIds,
      matchingCount,
      filters,
      businessId,
      toast,
      tToast,
      flashAck,
    ],
  );

  const bulkSetBillable = useCallback(
    async (billable: string): Promise<void> => {
      const fd = new FormData();
      fd.set("billable", billable);
      let count: number;
      if (selectAllMatching) {
        fd.set("scope", "filters");
        fd.set("businessId", businessId);
        appendFilterParams(fd, filters);
        count = matchingCount;
      } else {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        for (const id of ids) fd.append("id", id);
        count = ids.length;
      }
      const result = await bulkUpdateExpenseBillableAction(fd);
      if (result && "success" in result && !result.success) {
        toast.push({
          kind: "error",
          message: result.error.userMessageKey,
        });
        throw new Error(result.error.userMessageKey);
      }
      const message = tToast("bulkBillableAssigned", { count });
      flashAck(message);
      toast.push({ kind: "success", message });
    },
    [
      selectAllMatching,
      selectedIds,
      matchingCount,
      filters,
      businessId,
      toast,
      tToast,
      flashAck,
    ],
  );

  if (expenses.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="density-table rounded-lg border border-edge bg-surface-raised overflow-hidden">
      {/* Bulk-action strip — sibling above the table, NOT an
          absolute overlay. Per the updated CLAUDE.md
          "Multi-select tables" rule for wide tables (> 8
          semantic columns), the strip lives above the thead so
          column headers stay fully visible during bulk
          operations. Same surface tokens as the thead so the
          visual treatment reads as a continuation. */}
      {someSelected && (
        <div
          role="toolbar"
          aria-label={t("bulk.label")}
          className="flex items-center gap-3 border-b border-edge bg-surface-inset px-4 py-2"
        >
          {selectAllMatching ? (
            <span className="text-body font-medium text-content">
              {t("bulk.allMatchingSelected", { count: matchingCount })}
            </span>
          ) : (
            <span className="text-body font-medium text-content">
              {t("bulk.selectedCount", {
                hasFilter: hasFilter ? "true" : "false",
                count: selectedIds.size,
                filteredTotal: expenses.length,
                totalCount,
              })}
            </span>
          )}
          <button
            type="button"
            onClick={clearSelection}
            className="text-caption text-content-secondary hover:text-content hover:underline"
          >
            {t("bulk.clear")}
          </button>
          {/* Gmail two-step: when the user has selected every
              loaded row AND more rows match the filter than were
              loaded, surface a CTA to promote selection to the
              full match set. Without this, master-checkbox bulk
              would silently leave unloaded rows untouched — the
              audit-trail risk Agency Owner persona flagged. */}
          {!selectAllMatching && allLoadedSelected && paginated && (
            <button
              type="button"
              onClick={enableSelectAllMatching}
              className="text-caption font-medium text-accent hover:underline"
            >
              {t("bulk.selectAllMatching", { count: matchingCount })}
            </button>
          )}
          {bulkAckMessage && (
            <span
              className="inline-flex items-center gap-1.5 text-body font-medium text-success"
              role="status"
              aria-live="polite"
            >
              <Check size={14} className="shrink-0" />
              {bulkAckMessage}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <BulkCategoryPicker onSelect={bulkSetCategory} />
            <BulkProjectPicker
              projects={projects}
              onSelect={bulkSetProject}
            />
            <BulkBillablePicker onSelect={bulkSetBillable} />
            <Tooltip label={t("bulk.delete")}>
              <span className="inline-flex">
                <InlineDeleteRowConfirm
                  ariaLabel={t("bulk.delete")}
                  onConfirm={bulkDelete}
                  summary={tc("actions.deleteCount", {
                    count: selectAllMatching ? matchingCount : selectedIds.size,
                  })}
                />
              </span>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
      <table className="w-full table-fixed [&_td]:align-top">
        {/* Column-width lock. table-fixed + an explicit <colgroup>
            tells the browser to ignore intrinsic content widths
            during layout — without this, switching a cell to its
            edit input (whose <select> reports a wider intrinsic
            width than the display chip) reflows the whole row.
            Widths in px per CLAUDE.md "Layout dimensions in px,
            type and text-adjacent padding in rem" — they don't
            scale with text-size / density; text inside scales
            with rem-based typography rules and `truncate` keeps
            long values honest. The trailing <col /> with no
            width absorbs any slack so the table still fills
            w-full when declared widths sum less than container. */}
        {/* Widths sum to 1216px (single-team) — exactly the
            dashboard's 1280-max-width minus 32×2 padding. Multi-
            team adds the 140-px team column and triggers
            horizontal scroll via the wrapper's overflow-x-auto;
            acceptable cost for an agency view. No slack col —
            the sum equals the content area, so table-fixed has
            nothing to redistribute. */}
        <colgroup>
          <col style={{ width: 40 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 128 }} />
          {showTeamColumn && <col style={{ width: 140 }} />}
          <col style={{ width: 160 }} />
          <col style={{ width: 192 }} />
          <col style={{ width: 176 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 96 }} />
        </colgroup>
        <thead className="bg-surface-inset border-b border-edge sticky top-0 z-10">
          <tr>
            <th className="text-left">
              <span className="flex min-h-[1.75rem] items-center">
                <input
                  type="checkbox"
                  checked={selectAllMatching || allLoadedSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        !selectAllMatching &&
                        !allLoadedSelected &&
                        selectedIds.size > 0;
                  }}
                  onChange={toggleAll}
                  aria-label={t("bulk.selectAll")}
                  className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
                />
              </span>
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.incurredOn")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.amount")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.category")}
            </th>
            {showTeamColumn && (
              <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("fields.team")}
              </th>
            )}
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.vendor")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.description")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.notes")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.project")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.author")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {tc("table.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => {
            const role = teamRoleById.get(e.team_id) ?? "member";
            const canEdit =
              e.user_id === viewerUserId ||
              role === "owner" ||
              role === "admin";
            return (
              <ExpenseRow
                key={e.id}
                expense={e}
                author={authorById.get(e.user_id) ?? null}
                projects={projects}
                teamName={
                  showTeamColumn
                    ? (teamNameById.get(e.team_id) ?? null)
                    : null
                }
                columnCount={columnCount}
                canEdit={canEdit}
                selected={selectAllMatching || selectedIds.has(e.id)}
                onToggleSelect={toggleOne}
                isExpanded={expandedId === e.id}
                onToggleExpand={toggleExpand}
              />
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
