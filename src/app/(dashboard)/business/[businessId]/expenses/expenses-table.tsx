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
import {
  bulkDeleteExpensesAction,
  bulkRestoreExpensesAction,
  bulkUpdateExpenseCategoryAction,
  bulkUpdateExpenseProjectAction,
} from "./actions";
import { ExpenseRow, type ExpenseAuthor } from "./expense-row";
import { BulkCategoryPicker, BulkProjectPicker } from "./bulk-pickers";
import type { ProjectOption } from "./page";

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
}: Props): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const tToast = useTranslations("expenses.toast");
  const toast = useToast();

  // Selection state — id-keyed Set so toggling is O(1) and
  // selection survives re-renders triggered by an in-cell save
  // (cell save → re-fetch → expenses prop changes → component
  // re-renders, selection persists because state is local).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const allSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleOne = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((): void => {
    setSelectedIds((prev) => {
      if (prev.size > 0) return new Set();
      return new Set(visibleIds);
    });
  }, [visibleIds]);

  const clearSelection = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  // Escape clears an active selection. Only bound while
  // someSelected so we never swallow Escape on idle pages.
  useEffect(() => {
    if (!someSelected) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setSelectedIds(new Set());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [someSelected]);

  // ── Bulk action handlers ────────────────────────────────────

  const bulkDelete = useCallback(async () => {
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
  }, [selectedIds, toast, tToast]);

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
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      fd.set("category", category);
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
      const message = tToast("bulkCategorized", { count: ids.length });
      flashAck(message);
      toast.push({ kind: "success", message });
    },
    [selectedIds, toast, tToast, flashAck],
  );

  const bulkSetProject = useCallback(
    async (projectId: string): Promise<void> => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      fd.set("project_id", projectId);
      const result = await bulkUpdateExpenseProjectAction(fd);
      if (result && "success" in result && !result.success) {
        toast.push({
          kind: "error",
          message: result.error.userMessageKey,
        });
        throw new Error(result.error.userMessageKey);
      }
      const message = tToast("bulkProjectAssigned", { count: ids.length });
      flashAck(message);
      toast.push({ kind: "success", message });
    },
    [selectedIds, toast, tToast, flashAck],
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
          <span className="text-body font-medium text-content">
            {t("bulk.selectedCount", { count: selectedIds.size })}
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-caption text-content-secondary hover:text-content hover:underline"
          >
            {t("bulk.clear")}
          </button>
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
            <Tooltip label={t("bulk.delete")}>
              <span className="inline-flex">
                <InlineDeleteRowConfirm
                  ariaLabel={t("bulk.delete")}
                  onConfirm={bulkDelete}
                  summary={tc("actions.deleteCount", {
                    count: selectedIds.size,
                  })}
                />
              </span>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
      <table className="w-full table-fixed">
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
          <col style={{ width: 40 }} /> {/* selection */}
          <col style={{ width: 116 }} /> {/* date — 116 fits "Apr 11, 2019" w/ density padding */}
          <col style={{ width: 128 }} /> {/* category */}
          {showTeamColumn && <col style={{ width: 140 }} />}
          <col style={{ width: 160 }} /> {/* vendor */}
          <col style={{ width: 224 }} /> {/* description — most-elastic, absorbs date's +16 */}
          <col style={{ width: 176 }} /> {/* notes */}
          <col style={{ width: 140 }} /> {/* project */}
          <col style={{ width: 112 }} /> {/* amount */}
          <col style={{ width: 40 }} /> {/* author avatar */}
          <col style={{ width: 80 }} /> {/* actions */}
        </colgroup>
        <thead className="bg-surface-inset border-b border-edge">
          <tr>
            <th className="text-left">
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
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.incurredOn")}
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
            <th className="text-right text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.amount")}
            </th>
            <th className="text-left text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("fields.author")}
            </th>
            <th className="text-right text-label font-semibold uppercase tracking-wider text-content-muted">
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
                canEdit={canEdit}
                selected={selectedIds.has(e.id)}
                onToggleSelect={toggleOne}
              />
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
