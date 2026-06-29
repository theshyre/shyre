import { getTranslations } from "next-intl/server";
import { Receipt } from "lucide-react";
import { ProjectExpenseForm } from "./project-expense-form";
import {
  ProjectExpensesTable,
  type ProjectExpensesTableExpense,
} from "./project-expenses-table";
import type { ExpenseAuthor } from "@/app/(dashboard)/business/[businessId]/expenses/expense-row";
import type { ProjectOption } from "@/app/(dashboard)/business/[businessId]/expenses/page";

/** Re-export with the legacy name so consumers (the project page,
 *  the /projects/[id]/expenses route) don't need to be re-pointed. */
export type ExpensesSectionExpense = ProjectExpensesTableExpense;

/** Re-export the row-author shape under its phase-1 name for
 *  backward compatibility with the project page's existing typing. */
export type { ExpenseAuthor as ProjectExpenseRowAuthor };

interface Props {
  projectId: string;
  teamId: string;
  teamName: string;
  /** Business that hosts the project's team — kept on the interface
   *  for backward compat with the project page even though the
   *  full inline-editing table no longer deep-links out for edits
   *  (it edits in place). Future surfaces (e.g. a "manage all
   *  expenses" overflow link) may still want it. */
  businessId: string;
  expenses: ExpensesSectionExpense[];
  authorById: Map<string, ExpenseAuthor>;
  /** Active projects on the team — drives the in-row project picker
   *  so the user can re-link an expense to a different project from
   *  the project page. */
  projects: ProjectOption[];
  /** Distinct prior vendors across the project's team → native
   *  <datalist> suggestions on the add-form + inline vendor cells. */
  vendorOptions: string[];
  viewerUserId: string;
  viewerIsTeamAdmin: boolean;
  /** True when expenses RLS may be filtering out rows the viewer
   *  can't see (SAL-013: SELECT narrowed to author + owner/admin).
   *  The hint banner reads better than a silent empty list. */
  showScopedHint: boolean;
}

/**
 * Expenses on a project — full inline-edit table reusing the
 * business module's ExpenseRow + ExpenseExpandedRow (chevron expand
 * → full-width Description / Notes textareas + every field editable
 * via EditableCell). Bulk-select machinery is suppressed via
 * `hideSelection` on the row; bulk lives only on /business/[id]/
 * expenses.
 *
 * Cross-module note: this surface imports row + expanded-row
 * components from the business module. Platform-architect flagged
 * this as a layer violation in the phase-1 review; the user
 * explicitly chose the cross-module reuse over duplicating the
 * editable-row logic. Documented in
 * [[project-phase2-followups]] memory.
 */
export async function ExpensesSection({
  projectId,
  teamId,
  teamName,
  // businessId is preserved on the interface for forward compat
  // even though full inline editing no longer needs it for a
  // deep-link out — the row's invoiced chip uses /invoices/<id>
  // directly. Suppress the unused-arg lint by referencing it.
  businessId: _businessId,
  expenses,
  authorById,
  projects,
  vendorOptions,
  viewerUserId,
  viewerIsTeamAdmin,
  showScopedHint,
}: Props): Promise<React.JSX.Element> {
  const t = await getTranslations("projects.expenses");
  void _businessId;
  const count = expenses.length;

  return (
    <section className="mt-8" aria-labelledby="project-expenses-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt size={20} className="text-accent" aria-hidden="true" />
          <h2
            id="project-expenses-heading"
            className="text-title font-semibold text-content"
          >
            {t("title")}
          </h2>
          {count > 0 && (
            <span className="text-caption text-content-muted">
              {t("count", { count })}
            </span>
          )}
        </div>
      </div>

      {showScopedHint && count > 0 && (
        <p className="mt-2 text-caption text-content-muted" role="note">
          {t("scopedHint")}
        </p>
      )}

      <div className="mt-3">
        <ProjectExpenseForm
          teamId={teamId}
          teamName={teamName}
          projectId={projectId}
          vendorOptions={vendorOptions}
        />
      </div>

      {count === 0 ? (
        <p className="mt-4 text-body text-content-muted">{t("noExpenses")}</p>
      ) : (
        <div className="mt-4">
          <ProjectExpensesTable
            expenses={expenses}
            authorById={authorById}
            projects={projects}
            vendorOptions={vendorOptions}
            viewerUserId={viewerUserId}
            viewerIsTeamAdmin={viewerIsTeamAdmin}
          />
        </div>
      )}
    </section>
  );
}
