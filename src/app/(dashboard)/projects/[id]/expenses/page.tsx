import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadProject } from "../load-project";
import {
  ExpensesSection,
  type ExpensesSectionExpense,
  type ProjectExpenseRowAuthor,
} from "../expenses-section";
import type { ProjectOption } from "@/lib/expenses/types";
import { dedupeVendors } from "@/lib/expenses/vendor-options";

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
 * /projects/[id]/expenses — hosts the ExpensesSection built on the
 * shared expense primitives (`src/components/expenses/*` +
 * `@/lib/expenses/*`). Full inline editing here is the same code
 * path as the business surface, so the two stay in parity. The
 * full Pattern B editor (bulk strip, filters, import) still lives
 * at /business/[id]/expenses.
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
  // NOTE: `projects(id, name)` — NOT `projects(id, name, invoice_number)`.
  // invoice_number lives on `invoices`, not `projects`; PostgREST
  // returns a 400 on the unknown column and the whole select silently
  // resolves to `null`, which presented as "the expense disappeared."
  // The per-row invoice_number is resolved via the separate
  // `invoicesNumberById` lookup below.
  const { data: expenseRows, error: expensesError } = await supabase
    .from("expenses")
    .select(
      "id, team_id, user_id, incurred_on, amount, currency, vendor, external_reference, category, description, notes, project_id, billable, is_sample, invoiced, invoice_id, projects(id, name)",
    )
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (expensesError) {
    // Surface in the admin error log so a future similar regression
    // is visible rather than presenting as a silently-empty list.
    const { logError } = await import("@/lib/logger");
    void logError(expensesError, {
      url: `/projects/${id}/expenses`,
      action: "fetchProjectExpenses",
      userId: project.callerUserId,
      teamId: project.teamId,
    });
  }

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
        external_reference: (r.external_reference as string | null) ?? null,
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

  // Distinct prior vendors across the project's team → native
  // <datalist> suggestions on the add-form + inline vendor cells.
  // Team-scoped (not project-scoped) so vendors used on the team's
  // other projects still suggest here. RLS gates the read; free text
  // is always still accepted.
  const { data: teamVendorRows } = await supabase
    .from("expenses")
    .select("vendor")
    .eq("team_id", project.teamId)
    .is("deleted_at", null);
  const vendorOptions = dedupeVendors(
    (teamVendorRows ?? []).map((r) => r.vendor as string | null),
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
      projects={teamProjects}
      vendorOptions={vendorOptions}
      viewerUserId={project.callerUserId}
      viewerIsTeamAdmin={project.callerIsAdmin}
      showScopedHint={!project.callerIsAdmin}
    />
  );
}
