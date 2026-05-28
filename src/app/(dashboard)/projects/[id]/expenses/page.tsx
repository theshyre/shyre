import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadProject } from "../load-project";
import {
  ExpensesSection,
  type ExpensesSectionExpense,
} from "../expenses-section";
import type { ProjectExpenseRowAuthor } from "../project-expense-row";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  const t = await getTranslations("projects.sectionNav");
  return {
    title: `${t("expenses")} — ${(project.row.name as string | null) ?? ""}`,
  };
}

/**
 * /projects/[id]/expenses — hosts the existing ExpensesSection
 * (read + add-light + delete + edit-deep-link). Phase 3 keeps this
 * surface intentionally limited per platform-architect review:
 * promoting to full inline editing would deepen the cross-module
 * import dependency from this module into the business module's
 * expense components. The "Edit on Expenses page" deep-link on
 * each row goes to /business/[id]/expenses?project=<id> for the
 * full Pattern B editor.
 */
export default async function ProjectExpensesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const project = await loadProject(id);
  const supabase = await createClient();

  const { data: expenseRows } = await supabase
    .from("expenses")
    .select(
      "id, user_id, incurred_on, amount, currency, vendor, category, billable, invoiced, invoice_id, invoices(invoice_number)",
    )
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  const projectExpenses: ExpensesSectionExpense[] = (expenseRows ?? []).map(
    (r) => {
      const invoiceJoin = (r as { invoices: unknown }).invoices;
      const invoiceNumber =
        invoiceJoin &&
        typeof invoiceJoin === "object" &&
        "invoice_number" in invoiceJoin
          ? ((invoiceJoin as { invoice_number: string | null })
              .invoice_number ?? null)
          : null;
      return {
        id: r.id as string,
        user_id: r.user_id as string,
        incurred_on: r.incurred_on as string,
        amount: Number(r.amount),
        currency: (r.currency as string | null) ?? "USD",
        vendor: (r.vendor as string | null) ?? null,
        category: r.category as string,
        billable: r.billable === true,
        invoiced: r.invoiced === true,
        invoiceId: (r.invoice_id as string | null) ?? null,
        invoiceNumber,
      };
    },
  );

  const expenseAuthorIds = Array.from(
    new Set(projectExpenses.map((e) => e.user_id)),
  );
  const expenseAuthorById = new Map<string, ProjectExpenseRowAuthor>();
  if (expenseAuthorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", expenseAuthorIds);
    for (const p of profiles ?? []) {
      expenseAuthorById.set(p.user_id as string, {
        userId: p.user_id as string,
        displayName: (p.display_name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    }
  }

  return (
    <ExpensesSection
      projectId={id}
      teamId={project.teamId}
      teamName={project.teamName}
      businessId={project.businessId}
      expenses={projectExpenses}
      authorById={expenseAuthorById}
      viewerUserId={project.callerUserId}
      viewerIsTeamAdmin={project.callerIsAdmin}
      showScopedHint={!project.callerIsAdmin}
    />
  );
}
