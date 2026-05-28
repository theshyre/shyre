import { getTranslations } from "next-intl/server";
import { Receipt } from "lucide-react";
import {
  tableClass,
  tableHeaderCellClass,
  tableHeaderRowClass,
  tableWrapperClass,
} from "@/lib/table-styles";
import { ProjectExpenseForm } from "./project-expense-form";
import {
  ProjectExpenseRow,
  type ProjectExpenseRowAuthor,
  type ProjectExpenseRowExpense,
} from "./project-expense-row";

export interface ExpensesSectionExpense extends ProjectExpenseRowExpense {
  user_id: string;
}

interface Props {
  projectId: string;
  teamId: string;
  teamName: string;
  /** Business that hosts the project's team — used to build the
   *  deep-link to /business/<id>/expenses on each row's edit
   *  affordance. */
  businessId: string;
  expenses: ExpensesSectionExpense[];
  /** Display-name + avatar per user_id of every expense in scope.
   *  Pre-resolved by the page so this section stays presentational. */
  authorById: Map<string, ProjectExpenseRowAuthor>;
  viewerUserId: string;
  /** True when the viewer is owner or admin on the project's team.
   *  Drives the per-row delete affordance: owner/admin can delete
   *  any row in their team; everyone else can only delete rows they
   *  authored. Matches the action-layer + RLS gates. */
  viewerIsTeamAdmin: boolean;
  /** True when expenses RLS may be filtering out rows the viewer
   *  can't see (member-on-team, where SAL-013 narrowed SELECT to
   *  author + owner/admin). The hint banner reads better than a
   *  silent empty list when a teammate "knows there's an expense
   *  on this project." */
  showScopedHint: boolean;
}

/**
 * Expenses on a project — read + add + delete. Edit lives on the
 * main /business/[id]/expenses page (deep-linked per row) so this
 * surface stays single-purpose: log a project-scoped expense in
 * the same context you're already viewing.
 *
 * The form is rendered ABOVE the table so the primary action is
 * always one tab away from the header, even on a long table. Empty
 * state still renders the form: no expenses ≠ no path forward.
 *
 * RLS hint: expenses SELECT is gated to author + owner/admin per
 * SAL-013 (bookkeeper audit concerns). A member viewing a
 * teammate's project may see fewer rows than actually exist —
 * `showScopedHint` opts into a small disclaimer so the empty / short
 * list is explained instead of confusing.
 */
export async function ExpensesSection({
  projectId,
  teamId,
  teamName,
  businessId,
  expenses,
  authorById,
  viewerUserId,
  viewerIsTeamAdmin,
  showScopedHint,
}: Props): Promise<React.JSX.Element> {
  const t = await getTranslations("projects.expenses");
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
        />
      </div>

      {count === 0 ? (
        <p className="mt-4 text-body text-content-muted">{t("noExpenses")}</p>
      ) : (
        <div className={`mt-4 ${tableWrapperClass}`}>
          <table className={tableClass}>
            <thead>
              <tr className={tableHeaderRowClass}>
                <th className={`${tableHeaderCellClass} text-left`}>
                  {t("columns.date")}
                </th>
                <th className={`${tableHeaderCellClass} text-left`}>
                  {t("columns.author")}
                </th>
                <th className={`${tableHeaderCellClass} text-left`}>
                  {t("columns.category")}
                </th>
                <th className={`${tableHeaderCellClass} text-left`}>
                  {t("columns.vendor")}
                </th>
                <th className={`${tableHeaderCellClass} text-right`}>
                  {t("columns.amount")}
                </th>
                <th className={`${tableHeaderCellClass} text-left`}>
                  {t("columns.billable")}
                </th>
                <th className={`${tableHeaderCellClass} text-right`}>
                  <span className="sr-only">{t("editOnMain")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => {
                const canEdit =
                  viewerIsTeamAdmin || expense.user_id === viewerUserId;
                return (
                  <ProjectExpenseRow
                    key={expense.id}
                    expense={expense}
                    author={authorById.get(expense.user_id) ?? null}
                    canEdit={canEdit}
                    businessId={businessId}
                    projectId={projectId}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
