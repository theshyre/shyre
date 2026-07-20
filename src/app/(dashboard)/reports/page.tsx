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
import { CustomerChip } from "@theshyre/ui";
import { summarizeCollectedPayments } from "@/lib/reports/collected-revenue";
import { resolveRate } from "@/lib/rates/resolve-rate";
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
import { entryMatchesSource, resolveReportsSource } from "./reports-source";
import { ReportsSourceFilter } from "./reports-source-filter";

interface ClientSummary {
  name: string;
  customerId: string | null;
  customerLogoUrl: string | null;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  revenue: number;
  /** True when at least one billable entry rolled into this bucket
   *  had no visible rate anywhere in the cascade (masked by
   *  rate_visibility for this viewer, or genuinely unconfigured).
   *  `revenue` only sums the KNOWN portion, so a bucket with this set
   *  must render "—" rather than an understated number. */
  hasUnknownRate: boolean;
}

interface ProjectSummary {
  name: string;
  customerName: string;
  customerId: string | null;
  customerLogoUrl: string | null;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  revenue: number;
  hasUnknownRate: boolean;
}

interface MemberSummary {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  revenue: number;
  hasUnknownRate: boolean;
}

/** Renders a revenue cell — "—" when the underlying rate couldn't be
 *  resolved for every billable minute in the bucket, so the report
 *  never shows a silently-understated dollar figure. */
function revenueLabel(revenue: number, hasUnknownRate: boolean): string {
  if (hasUnknownRate) return "—";
  return formatCurrency(Math.round(revenue * 100) / 100);
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
    /** Source lens: all (default) / human / agent — separates
     *  agent-tracked hours from human-initiated ones (SAL-051 P3). */
    source?: string;
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
  const source = resolveReportsSource(params.source ?? null);
  const t = await getTranslations("reports");

  const userTeamIds = teams.map((tm) => tm.id);

  // Project list for the picker — includes BOTH parents and leaves
  // so a user can pick "the engagement" and roll up to children.
  // Scoped by team selection when set, else all the user's teams.
  //
  // Status filter is `!= archived`, NOT `= active`: a closed-out
  // (`completed`) project's time, revenue, and unbilled WIP stay in
  // every report total (the entries query below is date-scoped, not
  // status-scoped), so the picker must let you SELECT a closed
  // engagement to isolate it — e.g. "everything we closed in Q2" at
  // tax time. Only `archived` (soft-deleted / trash) is excluded.
  //
  // No rate column here — this query only ever feeds the name-based
  // filter picker, so the base `projects` table is fine (nothing to
  // mask).
  const projectsQuery = (() => {
    let q = supabase
      .from("projects")
      .select(
        "id, name, parent_project_id, is_internal, customers(id, name)",
      )
      .neq("status", "archived")
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
  //
  // Rate columns are deliberately NOT embedded here (no
  // `hourly_rate` / `default_rate` in this select) — this page is
  // visible to every team member, not just owners/admins, so rates
  // are resolved separately below via the Phase 2a `_v` views, which
  // mask a rate to NULL when the viewer isn't allowed to see it. The
  // embed here only carries names + ids for grouping/display.
  let entriesQuery = supabase
    .from("time_entries")
    .select(
      "user_id, team_id, project_id, duration_min, billable, started_by_kind, projects(name, is_internal, customers(id, name, logo_url))",
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
  const { data: rawEntryRows } = await entriesQuery;
  // Source lens: agent vs human (= everything not agent, so the two
  // buckets partition All exactly). Applied in JS via the same pure
  // helper the tests pin, keeping filter math in one place.
  const entries = (rawEntryRows ?? []).filter((entry) =>
    entryMatchesSource(entry.started_by_kind as string | null, source),
  );

  // Resolve the rate cascade (project → customer → member → team
  // default) for every entry via the masked `_v` views, keyed by id
  // so each level is a single scoped fetch rather than N+1 queries.
  interface EntryProject {
    name: string;
    is_internal: boolean | null;
    customers: {
      id: string;
      name: string;
      logo_url: string | null;
    } | null;
  }
  const projectIds = Array.from(
    new Set(
      entries
        .map((e) => e.project_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const customerIds = Array.from(
    new Set(
      entries
        .map((e) => {
          const proj = e.projects as unknown as EntryProject | null;
          return proj?.customers?.id ?? null;
        })
        .filter((id): id is string => id !== null),
    ),
  );
  const entryTeamIds = Array.from(
    new Set(entries.map((e) => e.team_id as string).filter(Boolean)),
  );

  const [
    { data: projectRateRows },
    { data: customerRateRows },
    { data: memberRateRows },
    { data: teamDefaultRateRows },
  ] = await Promise.all([
    projectIds.length
      ? supabase.from("projects_v").select("id, hourly_rate").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; hourly_rate: number | null }[] }),
    customerIds.length
      ? supabase
          .from("customers_v")
          .select("id, default_rate")
          .in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; default_rate: number | null }[] }),
    entryTeamIds.length
      ? supabase
          .from("team_members_v")
          .select("user_id, team_id, default_rate")
          .in("team_id", entryTeamIds)
      : Promise.resolve({
          data: [] as { user_id: string; team_id: string; default_rate: number | null }[],
        }),
    entryTeamIds.length
      ? supabase
          .from("team_settings_v")
          .select("team_id, default_rate")
          .in("team_id", entryTeamIds)
      : Promise.resolve({ data: [] as { team_id: string; default_rate: number | null }[] }),
  ]);

  const projectRateById = new Map<string, number | null>(
    (projectRateRows ?? []).map((r) => [
      r.id as string,
      r.hourly_rate == null ? null : Number(r.hourly_rate),
    ]),
  );
  const customerRateById = new Map<string, number | null>(
    (customerRateRows ?? []).map((r) => [
      r.id as string,
      r.default_rate == null ? null : Number(r.default_rate),
    ]),
  );
  const memberRateByTeamUser = new Map<string, number | null>(
    (memberRateRows ?? []).map((r) => [
      `${r.team_id as string}:${r.user_id as string}`,
      r.default_rate == null ? null : Number(r.default_rate),
    ]),
  );
  const teamDefaultRateByTeam = new Map<string, number | null>(
    (teamDefaultRateRows ?? []).map((r) => [
      r.team_id as string,
      r.default_rate == null ? null : Number(r.default_rate),
    ]),
  );

  // Aggregate by client / project / member
  const clientMap = new Map<string, ClientSummary>();
  const projectMap = new Map<string, ProjectSummary>();
  const memberMap = new Map<string, MemberSummary>();

  for (const entry of entries ?? []) {
    const proj = entry.projects as unknown as EntryProject | null;

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
    const teamId = entry.team_id as string;
    const projectId = (entry.project_id as string | null) ?? null;
    const customerId = proj?.customers?.id ?? null;
    const mins = entry.duration_min ?? 0;
    const isBillable = entry.billable ?? false;
    const hours = mins / 60;

    const rate = resolveRate({
      projectRate: projectId ? (projectRateById.get(projectId) ?? null) : null,
      customerRate: customerId
        ? (customerRateById.get(customerId) ?? null)
        : null,
      memberRate: userId
        ? (memberRateByTeamUser.get(`${teamId}:${userId}`) ?? null)
        : null,
      teamDefaultRate: teamDefaultRateByTeam.get(teamId) ?? null,
    });
    // Billable work with no resolvable rate is "unknown," not "$0" —
    // rendering it as 0 would silently understate revenue for a
    // masked or unconfigured rate. Non-billable entries never carry
    // a dollar value regardless of rate visibility.
    const rateUnknown = isBillable && rate === null;
    const entryRevenue = isBillable && rate !== null ? hours * rate : 0;

    // Client aggregation
    const existing = clientMap.get(customerName);
    if (existing) {
      existing.totalMinutes += mins;
      if (isBillable) existing.billableMinutes += mins;
      existing.entryCount += 1;
      existing.revenue += entryRevenue;
      existing.hasUnknownRate = existing.hasUnknownRate || rateUnknown;
    } else {
      clientMap.set(customerName, {
        name: customerName,
        customerId: proj?.customers?.id ?? null,
        customerLogoUrl: proj?.customers?.logo_url ?? null,
        totalMinutes: mins,
        billableMinutes: isBillable ? mins : 0,
        entryCount: 1,
        revenue: entryRevenue,
        hasUnknownRate: rateUnknown,
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
      existingProj.hasUnknownRate = existingProj.hasUnknownRate || rateUnknown;
    } else {
      projectMap.set(projKey, {
        name: projectName,
        customerName,
        customerId: proj?.customers?.id ?? null,
        customerLogoUrl: proj?.customers?.logo_url ?? null,
        totalMinutes: mins,
        billableMinutes: isBillable ? mins : 0,
        entryCount: 1,
        revenue: entryRevenue,
        hasUnknownRate: rateUnknown,
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
        existingMember.hasUnknownRate =
          existingMember.hasUnknownRate || rateUnknown;
      } else {
        memberMap.set(userId, {
          userId,
          displayName: "",
          avatarUrl: null,
          totalMinutes: mins,
          billableMinutes: isBillable ? mins : 0,
          entryCount: 1,
          revenue: entryRevenue,
          hasUnknownRate: rateUnknown,
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
  // The grand total is only trustworthy when every contributing
  // bucket resolved a rate for all its billable minutes — otherwise
  // it would silently understate revenue by the masked/unknown slice.
  const totalHasUnknownRate = clientSummaries.some((c) => c.hasUnknownRate);

  // Cash-basis collected revenue: recorded payments whose paid_on falls in
  // the period. Per-currency buckets — never summed across currencies.
  let paymentsQuery = supabase
    .from("invoice_payments")
    .select("amount, currency, paid_on, invoices(customer_id, customers(name))")
    .gte("paid_on", period.from)
    .lte("paid_on", period.to);
  if (selectedTeamId) {
    paymentsQuery = paymentsQuery.eq("team_id", selectedTeamId);
  } else if (userTeamIds.length > 0) {
    paymentsQuery = paymentsQuery.in("team_id", userTeamIds);
  }
  const { data: paymentRows } = await paymentsQuery;
  const collected = summarizeCollectedPayments(
    (paymentRows ?? []).map((row) => {
      const inv = Array.isArray(row.invoices)
        ? (row.invoices[0] ?? null)
        : (row.invoices as { customers?: unknown } | null);
      const cust = inv
        ? Array.isArray((inv as { customers: unknown }).customers)
          ? ((inv as { customers: Array<{ name: string }> }).customers[0] ?? null)
          : ((inv as { customers: { name: string } | null }).customers ?? null)
        : null;
      return {
        amount: Number(row.amount ?? 0),
        currency: (row.currency as string) ?? "USD",
        customerName: cust?.name ?? "—",
      };
    }),
  );
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

      <div className="mt-4 space-y-3">
        <ReportsPeriodFilter
          from={period.from}
          to={period.to}
          preset={period.preset}
        />
        <ReportsSourceFilter source={source} />
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <SummaryCard label={t("totals.totalHours")} value={fmtHours(totalMinutes)} />
        <SummaryCard label={t("table.billableHours")} value={fmtHours(totalBillable)} />
        <SummaryCard
          label={t("totals.totalRevenue")}
          value={revenueLabel(totalRevenue, totalHasUnknownRate)}
        />
        <SummaryCard label={t("totals.billablePercent")} value={`${billablePercent}%`} />
      </div>

      {/* Collected (cash basis) — per-currency, payments recorded in the
          period. The honest companion to Time-Based Revenue: fixed-price and
          proposal-derived income shows up HERE when the cash arrives. */}
      {collected.length > 0 && (
        <div className="mt-8">
          <h2 className="text-title font-semibold text-content">
            {t("collected.heading")}
          </h2>
          <p className="mt-1 text-caption text-content-secondary">
            {t("collected.subtitle")}
          </p>
          {/* This card is deliberately NOT scoped by the project filter
              above (payments aren't attributed to a single project) —
              say so explicitly rather than let the number look filtered
              when it isn't. */}
          <p className="mt-0.5 text-caption text-content-muted">
            {t("collected.scopeNote")}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collected.map((bucket) => (
              <div
                key={bucket.currency}
                className="rounded-lg border border-edge bg-surface-raised p-4"
              >
                <p className="text-caption font-semibold uppercase tracking-wider text-content-muted">
                  {t("collected.cardLabel", { currency: bucket.currency })}
                </p>
                <p className="mt-1 text-title font-bold font-mono text-content">
                  {formatCurrency(bucket.total, bucket.currency)}
                </p>
                <p className="text-caption text-content-muted">
                  {t("collected.paymentCount", { count: bucket.paymentCount })}
                </p>
                <ul className="mt-2 space-y-0.5">
                  {bucket.byClient.slice(0, 4).map((c) => (
                    <li
                      key={c.customerName}
                      className="flex justify-between gap-2 text-caption text-content-secondary"
                    >
                      <span className="truncate">{c.customerName}</span>
                      <span className="font-mono">
                        {formatCurrency(c.total, bucket.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    <th scope="col" className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.name")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.billableHours")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.revenue")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
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
                        <span className="inline-flex items-center gap-2">
                          <CustomerChip
                            customerId={c.customerId}
                            customerName={c.name}
                            logoUrl={c.customerLogoUrl}
                            size={24}
                          />
                          {c.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(c.totalMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(c.billableMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {revenueLabel(c.revenue, c.hasUnknownRate)}
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
                      {revenueLabel(totalRevenue, totalHasUnknownRate)}
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
                    <th scope="col" className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.name")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.client")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
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
                        <span className="inline-flex items-center gap-2">
                          <CustomerChip
                            customerId={p.customerId}
                            customerName={p.customerName}
                            logoUrl={p.customerLogoUrl}
                            size={16}
                          />
                          {p.customerName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(p.totalMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {revenueLabel(p.revenue, p.hasUnknownRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hours by Member — surfaces author-level breakdown for
              agency owners. Rendered unconditionally regardless of
              member count, per the time-entry-authorship mandate: who
              did the work is never conditionally hidden. */}
          <div className="mt-8">
            <h2 className="text-title font-semibold text-content">
              {t("sectionsExtra.byMember")}
            </h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-edge bg-surface-inset">
                    <th scope="col" className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.member")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.billableHours")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.revenue")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
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
                        {revenueLabel(m.revenue, m.hasUnknownRate)}
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
