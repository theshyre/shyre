import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Receipt, ArrowLeft } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { NewExpenseForm } from "./new-expense-form";
import { ExpenseRow } from "./expense-row";

interface ExpenseRecord {
  id: string;
  organization_id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string;
  description: string | null;
  project_id: string | null;
  billable: boolean;
  is_sample: boolean;
  projects: { id: string; name: string } | null;
}

export interface ProjectOption {
  id: string;
  name: string;
  organization_id: string;
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId } = await searchParams;
  const t = await getTranslations("expenses");
  const tc = await getTranslations("common");

  const orgId = selectedOrgId ?? orgs[0]?.id ?? null;

  let expenses: ExpenseRecord[] = [];
  let projects: ProjectOption[] = [];

  if (orgId) {
    const { data: expRows } = await supabase
      .from("expenses")
      .select(
        "id, organization_id, incurred_on, amount, currency, vendor, category, description, project_id, billable, is_sample, projects(id, name)",
      )
      .eq("organization_id", orgId)
      .order("incurred_on", { ascending: false })
      .order("created_at", { ascending: false });

    expenses = (expRows ?? []).map((r) => ({
      ...r,
      amount: Number(r.amount),
      projects: Array.isArray(r.projects) ? (r.projects[0] ?? null) : (r.projects ?? null),
    })) as ExpenseRecord[];

    const { data: projRows } = await supabase
      .from("projects")
      .select("id, name, organization_id")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .order("name");
    projects = (projRows ?? []) as ProjectOption[];
  }

  // Monthly total (current calendar month) — for the header chip.
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthTotal = expenses
    .filter((e) => e.incurred_on >= monthStart)
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href="/business"
          className="inline-flex items-center gap-1 text-sm text-content-muted hover:text-content"
        >
          <ArrowLeft size={14} />
          {t("back")}
        </Link>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Receipt size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={orgId} />
        {orgId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-xs font-medium text-content-secondary">
            {t("monthTotal", { amount: formatCurrency(monthTotal, "USD") })}
          </span>
        )}
      </div>

      {!orgId ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-sm text-content-muted">
          {t("noOrg")}
        </div>
      ) : (
        <>
          <NewExpenseForm
            orgId={orgId}
            projects={projects}
          />

          {expenses.length === 0 ? (
            <div className="rounded-lg border border-edge bg-surface-raised p-6 text-sm text-content-muted">
              {t("empty")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-edge bg-surface-raised">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge bg-surface-inset">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("fields.incurredOn")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("fields.category")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("fields.vendor")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("fields.project")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("fields.amount")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {tc("table.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <ExpenseRow key={e.id} expense={e} projects={projects} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
