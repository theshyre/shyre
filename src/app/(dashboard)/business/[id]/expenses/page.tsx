import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { NewExpenseForm } from "./new-expense-form";
import { ExpenseRow } from "./expense-row";

interface ExpenseRecord {
  id: string;
  team_id: string;
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
  team_id: string;
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

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ExpensesPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("expenses");
  const tc = await getTranslations("common");
  const { id: teamId } = await params;

  const { data: expRows } = await supabase
    .from("expenses")
    .select(
      "id, team_id, incurred_on, amount, currency, vendor, category, description, project_id, billable, is_sample, projects(id, name)",
    )
    .eq("team_id", teamId)
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  const expenses: ExpenseRecord[] = (expRows ?? []).map((r) => ({
    ...r,
    amount: Number(r.amount),
    projects: Array.isArray(r.projects) ? (r.projects[0] ?? null) : (r.projects ?? null),
  })) as ExpenseRecord[];

  const { data: projRows } = await supabase
    .from("projects")
    .select("id, name, team_id")
    .eq("team_id", teamId)
    .eq("status", "active")
    .order("name");
  const projects: ProjectOption[] = (projRows ?? []) as ProjectOption[];

  // Monthly total (current calendar month)
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthTotal = expenses
    .filter((e) => e.incurred_on >= monthStart)
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-body-lg font-semibold text-content">{t("title")}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-caption font-medium text-content-secondary">
          {t("monthTotal", { amount: formatCurrency(monthTotal, "USD") })}
        </span>
      </div>

      <NewExpenseForm teamId={teamId} projects={projects} />

      {expenses.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("fields.incurredOn")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("fields.category")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("fields.vendor")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("fields.project")}
                </th>
                <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("fields.amount")}
                </th>
                <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
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
    </div>
  );
}
