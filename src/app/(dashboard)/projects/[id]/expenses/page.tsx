import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadProject } from "../load-project";
import {
  ExpensesSection,
  type ExpensesSectionExpense,
  type ProjectExpenseRowAuthor,
} from "../expenses-section";
import type { ProjectOption } from "@/app/(dashboard)/business/[businessId]/expenses/page";

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

  // Phase-4: full inline-edit table needs every column the
  // EditableCell variants commit on (description, notes,
  // project_id, billable) PLUS the invoiced/invoice_number plumb
  // for the row's locked-state chip. The projects join provides
  // the row's current project name; the team-wide projects list
  // (below) drives the per-row picker for re-linking.
  const { data: expenseRows } = await supabase
    .from("expenses")
    .select(
      "id, team_id, user_id, incurred_on, amount, currency, vendor, category, description, notes, project_id, billable, is_sample, invoiced, invoice_id, projects(id, name, invoice_number)",
    )
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  // Separate invoice number lookup — the `projects(invoice_number)`
  // join above is bogus (projects has no invoice_number column). Fetch
  // distinct invoice_ids in one shot and map back per row.
  const distinctInvoiceIds = Array.from(
    new Set(
      (expenseRows ?? [])
        .map((r) => (r as { invoice_id: string | null }).invoice_id)
        .filter((id): id is string => !!id),
    ),
  );
  const invoiceNumberById = new Map<string, string>();
  if (distinctInvoiceIds.length > 0) {
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .in("id", distinctInvoiceIds);
    for (const inv of invs ?? []) {
      invoiceNumberById.set(
        inv.id as string,
        (inv.invoice_number as string | null) ?? "",
      );
    }
  }

  const projectExpenses: ExpensesSectionExpense[] = (expenseRows ?? []).map(
    (r) => {
      const projJoin = (r as { projects: unknown }).projects;
      const projObj =
        projJoin && typeof projJoin === "object" && "id" in projJoin
          ? (projJoin as { id: string | null; name: string | null })
          : null;
      const invoiceId = (r.invoice_id as string | null) ?? null;
      return {
        id: r.id as string,
        team_id: r.team_id as string,
        user_id: r.user_id as string,
        incurred_on: r.incurred_on as string,
        amount: Number(r.amount),
        currency: (r.currency as string | null) ?? "USD",
        vendor: (r.vendor as string | null) ?? null,
        category: r.category as string,
        description: (r.description as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        project_id: (r.project_id as string | null) ?? null,
        billable: r.billable === true,
        is_sample: (r as { is_sample: boolean | null }).is_sample === true,
        projects: projObj?.id && projObj.name
          ? { id: projObj.id, name: projObj.name }
          : null,
        invoiced: r.invoiced === true,
        invoice_id: invoiceId,
        invoice_number: invoiceId
          ? (invoiceNumberById.get(invoiceId) ?? null)
          : null,
      };
    },
  );

  // Active projects on the project's team — drives the per-row
  // project picker so the user can re-link an expense from this
  // surface (rare but useful). Filtered by team to match the
  // ExpenseRow's internal filter.
  const { data: teamProjectRows } = await supabase
    .from("projects")
    .select("id, name, team_id")
    .eq("team_id", project.teamId)
    .eq("status", "active")
    .order("name");
  const teamProjects: ProjectOption[] = (teamProjectRows ?? []) as ProjectOption[];

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
      projects={teamProjects}
      viewerUserId={project.callerUserId}
      viewerIsTeamAdmin={project.callerIsAdmin}
      showScopedHint={!project.callerIsAdmin}
    />
  );
}
