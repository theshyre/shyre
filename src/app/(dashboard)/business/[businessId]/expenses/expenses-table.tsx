"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
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

  // Measure thead height so the bulk-action strip overlays the
  // header row pixel-perfectly across density / text-size changes.
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [theadHeight, setTheadHeight] = useState<number>(0);
  useEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const update = (): void => {
      setTheadHeight(el.getBoundingClientRect().height);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const bulkSetCategory = useCallback(
    async (category: string): Promise<void> => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      fd.set("category", category);
      await bulkUpdateExpenseCategoryAction(fd);
      setSelectedIds(new Set());
      toast.push({
        kind: "info",
        message: tToast("bulkCategorized", { count: ids.length }),
      });
    },
    [selectedIds, toast, tToast],
  );

  const bulkSetProject = useCallback(
    async (projectId: string): Promise<void> => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      fd.set("project_id", projectId);
      await bulkUpdateExpenseProjectAction(fd);
      setSelectedIds(new Set());
      toast.push({
        kind: "info",
        message: tToast("bulkProjectAssigned", { count: ids.length }),
      });
    },
    [selectedIds, toast, tToast],
  );

  if (expenses.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="density-table relative overflow-x-auto rounded-lg border border-edge bg-surface-raised">
      <table className="w-full">
        <thead
          ref={theadRef}
          className="bg-surface-inset border-b border-edge"
          aria-hidden={someSelected || undefined}
        >
          <tr>
            <th className="w-10 text-left">
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

      {someSelected && (
        <div
          role="toolbar"
          aria-label={t("bulk.label")}
          className="absolute left-0 right-0 top-0 z-10 flex items-center gap-3 bg-surface-inset border-b border-edge px-4"
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

          <div className="ml-auto flex items-center gap-2">
            <BulkCategoryPicker onSelect={bulkSetCategory} />
            <BulkProjectPicker
              projects={projects}
              onSelect={bulkSetProject}
            />
            <Tooltip label={t("bulk.delete")}>
              <span style={{ display: "inline-flex" }}>
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
    </div>
  );
}
