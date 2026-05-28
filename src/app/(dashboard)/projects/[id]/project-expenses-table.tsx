"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
// `tc` for the "Actions" column header — matches the business-side
// expenses table's `tc("table.actions")` lookup so both surfaces
// share the same label.
import {
  tableHeaderCellClass,
  tableHeaderRowClass,
} from "@/lib/table-styles";
import {
  ExpenseRow,
  type ExpenseAuthor,
} from "@/app/(dashboard)/business/[businessId]/expenses/expense-row";
import type { ProjectOption } from "@/app/(dashboard)/business/[businessId]/expenses/page";

export interface ProjectExpensesTableExpense {
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
  invoiced: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
}

interface Props {
  expenses: ProjectExpensesTableExpense[];
  authorById: Map<string, ExpenseAuthor>;
  /** Active projects on the team — drives the in-row project picker
   *  so the user can re-link an expense to a different project from
   *  this surface. Empty array = picker shows only "no project". */
  projects: ProjectOption[];
  viewerUserId: string;
  /** True when the viewer is owner/admin on the project's team —
   *  drives the per-row delete affordance and EditableCell enable.
   *  Members can mutate only rows they authored, mirroring the
   *  action-layer + RLS gates. */
  viewerIsTeamAdmin: boolean;
}

/**
 * Project-page expenses table — reuses the business module's
 * full `<ExpenseRow>` (with inline-editable cells, chevron
 * expand-to-edit-description-and-notes, and the invoiced lock
 * chip) instead of the read+add-light variant that shipped with
 * phase 1.
 *
 * Bulk-select machinery is suppressed via `hideSelection` on the
 * row — there's no bulk strip here. Expansion is local state
 * (one expanded row at a time; opening another collapses the
 * current). Column count is 9: Date / Amount / Category / Vendor /
 * Description / Notes / Project / Author / Actions — matches the
 * thead below so the expanded row's colSpan covers the full width.
 */
export function ProjectExpensesTable({
  expenses,
  authorById,
  projects,
  viewerUserId,
  viewerIsTeamAdmin,
}: Props): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);
  // No-op for the bulk-select handler — `hideSelection` on the row
  // suppresses the checkbox anyway, but the prop is still required.
  const noop = useCallback(() => {}, []);

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-raised">
      <table className="w-full text-body">
        <colgroup>
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-36" />
          <col className="w-32" />
          <col />
          <col />
          <col className="w-36" />
          <col className="w-12" />
          <col className="w-32" />
        </colgroup>
        <thead>
          <tr className={tableHeaderRowClass}>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.incurredOn")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.amount")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.category")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.vendor")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.description")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.notes")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              {t("fields.project")}
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              <span className="sr-only">{t("fields.author")}</span>
            </th>
            <th className={`${tableHeaderCellClass} text-left`}>
              <span className="sr-only">{tc("table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => {
            // Server-side already gates RLS; this mirrors so the UI
            // doesn't promise an edit affordance the server will deny.
            const canEdit =
              viewerIsTeamAdmin || expense.user_id === viewerUserId;
            return (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                author={authorById.get(expense.user_id) ?? null}
                projects={projects}
                teamName={null}
                columnCount={9}
                canEdit={canEdit}
                selected={false}
                onToggleSelect={noop}
                isExpanded={expandedId === expense.id}
                onToggleExpand={toggleExpand}
                hideSelection
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
