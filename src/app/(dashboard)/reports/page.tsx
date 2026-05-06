import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { BarChart3 } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: t("title") };
}
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { formatCurrency } from "@/lib/invoice-utils";
import { TeamFilter } from "@/components/TeamFilter";
import {
  ProjectFilter,
  type ProjectFilterOption,
} from "@/components/ProjectFilter";
import { expandProjectFilter } from "@/lib/projects/expand-filter";
import {
  fromIsoStartOfDay,
  resolveReportsPeriod,
  toIsoEndOfDay,
} from "./reports-period";
import { ReportsPeriodFilter } from "./reports-period-filter";

interface ClientSummary {
  name: string;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  revenue: number;
}

interface ProjectSummary {
  name: string;
  customerName: string;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  rate: number;
  revenue: number;
}

interface MemberSummary {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  revenue: number;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    org?: string;
    from?: string;
    to?: string;
    preset?: string;
    /** Selected project id; expanded server-side to parent + leaf
     *  children when the id refers to a parent project. Unset = no
     *  project filter (totals span every visible project in scope). */
    project?: string;
  }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const params = await searchParams;
  const selectedTeamId = params.org;
  const projectFilterId = params.project?.trim() || null;
  const period = resolveReportsPeriod({
    from: params.from ?? null,
    to: params.to ?? null,
    preset: params.preset ?? null,
  });
  const t = await getTranslations("reports");

  const userTeamIds = teams.map((tm) => tm.id);

  // Project list for the picker — includes BOTH parents and leaves
  // so a user can pick "the engagement" and roll up to children.
  // Scoped by team selection when set, else all the user's teams.
  const projectsQuery = (() => {
    let q = supabase
      .from("projects")
      .select(
        "id, name, parent_project_id, is_internal, customers(id, name)",
      )
      .eq("status", "active")
      .order("name");
    if (selectedTeamId) {
      q = q.eq("team_id", selectedTeamId);
    } else if (userTeamIds.length > 0) {
      q = q.in("team_id", userTeamIds);
    }
    return q;
  })();
  const { data: rawProjects } = await projectsQuery;
  const filterPickerProjects: ProjectFilterOption[] = (rawProjects ?? []).map(
    (p) => {
      const customers = p.customers as
        | { name?: string | null }
        | Array<{ name?: string | null }>
        | null;
      const customer = Array.isArray(customers)
        ? (customers[0] ?? null)
        : customers;
      return {
        id: p.id as string,
        name: p.name as string,
        parent_project_id: (p.parent_project_id as string | null) ?? null,
        customer_name: customer?.name ?? null,
        is_internal: Boolean(p.is_internal),
      };
    },
  );
  const expandedProjectIds = projectFilterId
    ? expandProjectFilter(filterPickerProjects, projectFilterId)
    : null;

  // Fetch time entries with project + client + author info, scoped
  // to the active period. Without a date scope this used to roll up
  // every entry the viewer could see — useless after the first
  // quarter and inconsistent with the documented bookkeeper export
  // contract.
  let entriesQuery = supabase
    .from("time_entries")
    .select(
      "user_id, duration_min, billable, projects(name, hourly_rate, is_internal, customers(name, default_rate))",
    )
    .not("end_time", "is", null)
    .not("duration_min", "is", null)
    .is("deleted_at", null)
    .gte("start_time", fromIsoStartOfDay(period.from))
    .lte("start_time", toIsoEndOfDay(period.to));
  if (selectedTeamId) entriesQuery = entriesQuery.eq("team_id", selectedTeamId);
  if (expandedProjectIds !== null) {
    entriesQuery = entriesQuery.in("project_id", expandedProjectIds);
  }
  const { data: entries } = await entriesQuery;

  // Get org's default rate (use selected org's settings if filtered, otherwise 0)
  let defaultRate = 0;
  if (selectedTeamId) {
    const { data: settings } = await supabase
      .from("team_settings")
      .select("default_rate")
      .eq("team_id", selectedTeamId)
      .single();
    defaultRate = settings?.default_rate ? Number(settings.default_rate) : 0;
  }

  // Aggregate by client / project / member
  const clientMap = new Map<string, ClientSummary>();
  const projectMap = new Map<string, ProjectSummary>();
  const memberMap = new Map<string, MemberSummary>();

  for (const entry of entries ?? []) {
    const proj = entry.projects as unknown as {
      name: string;
      hourly_rate: number | null;
      is_internal: boolean | null;
      customers: { name: string; default_rate: number | null } | null;
    } | null;

    // Distinguish "Internal" (is_internal=true, no customer by
    // construction) from any other null-customer case (legacy
    // pre-migration data, or RLS hiding the customer row from this
    // viewer). The bucket label "Internal" should be reserved for
    // formally-internal projects so the report doesn't conflate
    // categorization with visibility.
    const customerName =
      proj?.is_internal === true
        ? "Internal"
        : (proj?.customers?.name ?? "—");
    const projectName = proj?.name ?? "Unknown";
    const userId = (entry.user_id as string | null) ?? null;
    const mins = entry.duration_min ?? 0;
    const isBillable = entry.billable ?? false;
    const rate =
      (proj?.hourly_rate ? Number(proj.hourly_rate) : null) ??
      (proj?.customers?.default_rate ? Number(proj.customers.default_rate) : null) ??
      defaultRate;
    const hours = mins / 60;
    const entryRevenue = isBillable ? hours * rate : 0;

    // Client aggregation
    const existing = clientMap.get(customerName);
    if (existing) {
      existing.totalMinutes += mins;
      if (isBillable) existing.billableMinutes += mins;
      existing.entryCount += 1;
      existing.revenue += entryRevenue;
    } else {
      clientMap.set(customerName, {
        name: customerName,
        totalMinutes: mins,
        billableMinutes: isBillable ? mins : 0,
        entryCount: 1,
        revenue: entryRevenue,
      });
    }

    // Project aggregation
    const projKey = `${customerName}::${projectName}`;
    const existingProj = projectMap.get(projKey);
    if (existingProj) {
      existingProj.totalMinutes += mins;
      if (isBillable) existingProj.billableMinutes += mins;
      existingProj.entryCount += 1;
      existingProj.revenue += entryRevenue;
    } else {
      projectMap.set(projKey, {
        name: projectName,
        customerName,
        totalMinutes: mins,
        billableMinutes: isBillable ? mins : 0,
        entryCount: 1,
        rate,
        revenue: entryRevenue,
      });
    }

    // Member aggregation
    if (userId) {
      const existingMember = memberMap.get(userId);
      if (existingMember) {
        existingMember.totalMinutes += mins;
        if (isBillable) existingMember.billableMinutes += mins;
        existingMember.entryCount += 1;
        existingMember.revenue += entryRevenue;
      } else {
        memberMap.set(userId, {
          userId,
          displayName: "",
          avatarUrl: null,
          totalMinutes: mins,
          billableMinutes: isBillable ? mins : 0,
          entryCount: 1,
          revenue: entryRevenue,
        });
      }
    }
  }

  // Resolve member display names + avatars in a single round-trip,
  // shaped to match the EntryAuthor pattern used elsewhere.
  if (memberMap.size > 0) {
    const userIds = Array.from(memberMap.keys());
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      const m = memberMap.get(p.user_id as string);
      if (m) {
        m.displayName = (p.display_name as string | null) ?? "";
        m.avatarUrl = (p.avatar_url as string | null) ?? null;
      }
    }
  }
  const memberSummaries = Array.from(memberMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes,
  );

  const clientSummaries = Array.from(clientMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );
  const projectSummaries = Array.from(projectMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );

  const totalMinutes = clientSummaries.reduce((s, c) => s + c.totalMinutes, 0);
  const totalBillable = clientSummaries.reduce((s, c) => s + c.billableMinutes, 0);
  const totalRevenue = clientSummaries.reduce((s, c) => s + c.revenue, 0);
  const billablePercent = totalMinutes > 0 ? Math.round((totalBillable / totalMinutes) * 100) : 0;

  const fmtHours = (mins: number): string => `${(mins / 60).toFixed(1)}h`;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <BarChart3 size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        <TeamFilter teams={teams} selectedTeamId={selectedTeamId ?? null} />
        <ProjectFilter
          projects={filterPickerProjects}
          selectedId={projectFilterId}
        />
      </div>

      <p className="mt-2 text-body text-content-muted">
        {t("period.label", { from: period.from, to: period.to })}
      </p>

      <div className="mt-4">
        <ReportsPeriodFilter
          from={period.from}
          to={period.to}
          preset={period.preset}
        />
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <SummaryCard label={t("totals.totalHours")} value={fmtHours(totalMinutes)} />
        <SummaryCard label={t("table.billableHours")} value={fmtHours(totalBillable)} />
        <SummaryCard label={t("totals.totalRevenue")} value={formatCurrency(Math.round(totalRevenue * 100) / 100)} />
        <SummaryCard label={t("totals.billablePercent")} value={`${billablePercent}%`} />
      </div>

      {clientSummaries.length === 0 ? (
        <p className="mt-8 text-body text-content-muted">{t("noData")}</p>
      ) : (
        <>
          {/* Hours by Client */}
          <div className="mt-8">
            <h2 className="text-title font-semibold text-content">
              {t("sections.byClient")}
            </h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-edge bg-surface-inset">
                    <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.name")}
                    </th>
                    <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.billableHours")}
                    </th>
                    <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.revenue")}
                    </th>
                    <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.entries")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clientSummaries.map((c) => (
                    <tr
                      key={c.name}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-content">
                        {c.name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(c.totalMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(c.billableMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {formatCurrency(Math.round(c.revenue * 100) / 100)}
                      </td>
                      <td className="px-4 py-3 text-right text-content-secondary">
                        {c.entryCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-edge bg-surface-inset">
                    <td className="px-4 py-3 font-semibold text-content">
                      {t("totals.total")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-content">
                      {fmtHours(totalMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-content">
                      {fmtHours(totalBillable)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-content">
                      {formatCurrency(Math.round(totalRevenue * 100) / 100)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-content">
                      {clientSummaries.reduce((s, c) => s + c.entryCount, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Hours by Project */}
          <div className="mt-8">
            <h2 className="text-title font-semibold text-content">
              {t("sections.byProject")}
            </h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-edge bg-surface-inset">
                    <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.name")}
                    </th>
                    <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.client")}
                    </th>
                    <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.revenue")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projectSummaries.map((p) => (
                    <tr
                      key={`${p.customerName}::${p.name}`}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-content">
                        {p.name}
                      </td>
                      <td className="px-4 py-3 text-content-secondary">
                        {p.customerName}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(p.totalMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {formatCurrency(Math.round(p.revenue * 100) / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hours by Member — surfaces author-level breakdown for
              agency owners. Hidden for solo teams (single member,
              no signal). */}
          {memberSummaries.length > 1 && (
            <div className="mt-8">
              <h2 className="text-title font-semibold text-content">
                {t("sectionsExtra.byMember")}
              </h2>
              <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
                <table className="w-full text-body">
                  <thead>
                    <tr className="border-b border-edge bg-surface-inset">
                      <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                        {t("table.member")}
                      </th>
                      <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                        {t("table.hours")}
                      </th>
                      <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                        {t("table.billableHours")}
                      </th>
                      <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                        {t("table.revenue")}
                      </th>
                      <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                        {t("table.entries")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberSummaries.map((m) => (
                      <tr
                        key={m.userId}
                        className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2 text-content">
                            <Avatar
                              avatarUrl={resolveAvatarUrl(
                                m.avatarUrl,
                                m.userId,
                              )}
                              displayName={m.displayName}
                              size={20}
                            />
                            <span className="font-medium">
                              {m.displayName}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-content-secondary">
                          {fmtHours(m.totalMinutes)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-content-secondary">
                          {fmtHours(m.billableMinutes)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-content">
                          {formatCurrency(
                            Math.round(m.revenue * 100) / 100,
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-content-secondary">
                          {m.entryCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <p className="text-label font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </p>
      <p className="mt-1 text-title font-bold font-mono text-content">{value}</p>
    </div>
  );
}
