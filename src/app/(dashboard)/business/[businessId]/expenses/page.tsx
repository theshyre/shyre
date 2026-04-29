import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { getUserTeams } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses");
  return { title: t("title") };
}
import { NewExpenseForm } from "./new-expense-form";
import { ExpenseRow } from "./expense-row";

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
  params: Promise<{ businessId: string }>;
}

export default async function ExpensesPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("expenses");
  const tc = await getTranslations("common");
  const { businessId } = await params;

  // Expenses are still team_id-scoped at the row level. The page
  // sums across every team in the business that the viewer can
  // access. Single-team businesses see no team UI; multi-team
  // agencies get a team picker on new-expense and a team column on
  // the list so they can target and trace expenses.
  const userTeams = await getUserTeams();
  const userTeamIds = userTeams.map((tm) => tm.id);
  const { data: businessTeams } =
    userTeamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id")
          .eq("business_id", businessId)
          .in("id", userTeamIds)
      : { data: [] };
  const teamIds = (businessTeams ?? []).map((row) => row.id as string);
  if (teamIds.length === 0) {
    notFound();
  }
  const teamOptions = userTeams
    .filter((tm) => teamIds.includes(tm.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tm) => ({ id: tm.id, name: tm.name, role: tm.role }));
  const representativeTeamId = teamOptions[0]!.id;
  const showTeamColumn = teamOptions.length > 1;
  const teamNameById = new Map(teamOptions.map((tm) => [tm.id, tm.name]));
  // Per-team role lookup for canEdit gating: author OR owner|admin.
  // Role check matches the action-layer guard so the UI doesn't
  // promise something the server denies.
  const teamRoleById = new Map(teamOptions.map((tm) => [tm.id, tm.role]));

  // Viewer's user_id powers the author check on each row.
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const viewerUserId = viewer?.id ?? null;

  const { data: expRows } = await supabase
    .from("expenses")
    .select(
      "id, team_id, user_id, incurred_on, amount, currency, vendor, category, description, project_id, billable, is_sample, projects(id, name)",
    )
    .in("team_id", teamIds)
    .is("deleted_at", null)
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
    .in("team_id", teamIds)
    .eq("status", "active")
    .order("name");
  const projects: ProjectOption[] = (projRows ?? []) as ProjectOption[];

  // Bulk-fetch authors (avatar + display_name) for the visible
  // expenses. Per the time-entry-authorship rule, every row must
  // attribute its submitter.
  const userIds = Array.from(new Set(expenses.map((e) => e.user_id)));
  const authorById = new Map<
    string,
    { userId: string; displayName: string | null; avatarUrl: string | null }
  >();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      authorById.set(p.user_id as string, {
        userId: p.user_id as string,
        displayName: (p.display_name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    }
  }

  // Latest period lock per team in scope — drives the "Locked
  // through" banner on the page header.
  const { data: lockRows } = await supabase
    .from("team_period_locks")
    .select("team_id, period_end")
    .in("team_id", teamIds);
  const latestLockByTeam = new Map<string, string>();
  for (const r of lockRows ?? []) {
    const tid = r.team_id as string;
    const cur = latestLockByTeam.get(tid);
    const next = r.period_end as string;
    if (!cur || cur < next) latestLockByTeam.set(tid, next);
  }
  const lockSummary =
    latestLockByTeam.size === 0
      ? null
      : Array.from(latestLockByTeam.entries())
          .map(([tid, end]) =>
            showTeamColumn
              ? `${teamNameById.get(tid) ?? ""}: ${end}`
              : end,
          )
          .join(" · ");

  // Monthly total (current calendar month). Expenses can be logged
  // in different currencies, so sum per-currency and render each
  // group on its own — naively summing across currencies would
  // silently produce a wrong number.
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthByCurrency = new Map<string, number>();
  for (const e of expenses) {
    if (e.incurred_on < monthStart) continue;
    const code = (e.currency ?? "USD").toUpperCase();
    monthByCurrency.set(code, (monthByCurrency.get(code) ?? 0) + e.amount);
  }
  const monthTotalLabel =
    monthByCurrency.size === 0
      ? formatCurrency(0, "USD")
      : Array.from(monthByCurrency.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([code, amt]) => formatCurrency(amt, code))
          .join(" · ");

  // Recategorize callout: every CSV-imported expense lands in
  // category="other" by default. Surface a single soft banner when
  // the count is non-trivial — quiet enough to ignore on a clean
  // ledger, prominent enough to notice after an import. Threshold
  // of 1 keeps the rule simple; users who categorize as they go
  // will never see it.
  const otherCount = expenses.filter((e) => e.category === "other").length;
  // Import CSV link is owner|admin only — same gate as the
  // /business/[businessId]/expenses/import page itself, but checked
  // here to hide the entry point from members who would 404 on click.
  const canImport = Array.from(teamRoleById.values()).some(
    (r) => r === "owner" || r === "admin",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-body-lg font-semibold text-content">{t("title")}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-caption font-medium text-content-secondary">
          {t("monthTotal", { amount: monthTotalLabel })}
        </span>
        {canImport && (
          <Link
            href={`/business/${businessId}/expenses/import`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1.5 text-caption font-medium text-content-secondary hover:bg-hover transition-colors"
          >
            <Upload size={14} />
            {t("importCsv")}
            <LinkPendingSpinner size={10} className="" />
          </Link>
        )}
      </div>

      {lockSummary && (
        <div
          className="rounded-md border border-edge bg-surface-inset px-3 py-2 text-caption text-content-secondary"
          role="status"
        >
          <span className="font-semibold text-content">
            {t("lockedThrough")}
          </span>{" "}
          {lockSummary}
        </div>
      )}

      {otherCount > 0 && (
        <div
          className="rounded-md border border-warning/40 bg-warning-soft/20 px-3 py-2 text-caption text-content-secondary"
          role="status"
        >
          <span className="font-semibold text-warning">
            {t("recategorizeBanner.title", { count: otherCount })}
          </span>{" "}
          {t("recategorizeBanner.body")}
        </div>
      )}

      <NewExpenseForm
        defaultTeamId={representativeTeamId}
        teamOptions={teamOptions}
        projects={projects}
      />

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
                {showTeamColumn && (
                  <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                    {t("fields.team")}
                  </th>
                )}
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
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
