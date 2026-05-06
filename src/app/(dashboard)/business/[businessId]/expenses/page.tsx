import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Upload, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { getUserTeams } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { TableDensityToggle } from "@/components/TableDensityToggle";
import { TableDensityDefault } from "@/components/TableDensityDefault";
import { ExpensesTable } from "./expenses-table";
import { ExpenseFilters } from "./expense-filters";
import {
  ExpenseSummaryTiles,
  type PeriodTotal,
} from "./expense-summary-tiles";
import { parseExpenseFilters, hasActiveFilters } from "./filter-params";
import { applyExpenseFilters } from "./query-filters";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { PaginationFooter } from "@/components/PaginationFooter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses");
  return { title: t("title") };
}
import { NewExpenseForm } from "./new-expense-form";

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
  notes: string | null;
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Given an exclusive end-of-period date string (YYYY-MM-DD), return
 * the inclusive last day before it. Used to convert exclusive period
 * upper bounds (e.g. "first of next month") into the inclusive
 * `to` filter the URL expects (e.g. "last day of this month").
 */
function lastDateBefore(yyyymmdd: string): string {
  const [yStr, mStr, dStr] = yyyymmdd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

interface PageProps {
  params: Promise<{ businessId: string }>;
  /** URL-driven filter state — see filter-params.ts. Next 16
   *  hands these as a possibly-async object on App Router. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ExpensesPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("expenses");
  const { businessId } = await params;
  const rawSearchParams = await searchParams;
  const filters = parseExpenseFilters(rawSearchParams);
  // Server-side pagination: default 50 rows on first render, grow
  // via "?limit=N" with the load-more footer. URL-driven so the
  // state is bookmarkable + survives a refresh.
  const { limit } = parseListPagination(rawSearchParams);

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

  // Fetch every expense under the business teams (for the year
  // dropdown's distinct-years computation), then build a separate
  // filtered query for the rendered list. Two queries instead of
  // one because the year dropdown needs the full data set's date
  // range — filtering it would hide other available years.
  const { data: allYearsRows } = await supabase
    .from("expenses")
    .select("incurred_on")
    .in("team_id", teamIds)
    .is("deleted_at", null);
  const availableYears = Array.from(
    new Set(
      (allYearsRows ?? []).flatMap((r) => {
        const d = (r.incurred_on as string | null) ?? "";
        const m = /^(\d{4})-/.exec(d);
        return m && m[1] ? [m[1]] : [];
      }),
    ),
  ).sort((a, b) => b.localeCompare(a)); // newest first

  // count: "exact" piggybacks on the same RLS pass — one query
  // returns both the page rows AND the full match count, so the
  // load-more footer + filter-bar count badge can show "showing 50
  // of 312" without a second round-trip. Stable ordering needs the
  // id tiebreaker because (incurred_on, created_at) isn't unique
  // across CSV imports landing many rows in the same ms — without
  // it, .range() can drop or duplicate rows across "Load more"
  // clicks under concurrent writes.
  //
  // Filter clauses are applied via the shared `applyExpenseFilters`
  // helper so the bulk actions running in filter-scope mode
  // ("Select all N matching") apply EXACTLY the same filters as
  // the rendered list. Drift between the two would be a class of
  // bugs we want to make impossible.
  const baseExpensesQuery = supabase
    .from("expenses")
    .select(
      "id, team_id, user_id, incurred_on, amount, currency, vendor, category, description, notes, project_id, billable, is_sample, projects(id, name)",
      { count: "exact" },
    )
    .in("team_id", teamIds)
    .is("deleted_at", null);

  const expensesQuery = applyExpenseFilters(baseExpensesQuery, filters);

  const { data: expRows, count: matchingCount } = await expensesQuery
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, limit - 1);

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

  // Monthly total (current calendar month). MUST come from a
  // dedicated query scoped to teamIds + current-month, NOT
  // computed from the rendered `expenses` array — the rendered
  // set is filtered AND paginated, so summing it would (a) hide
  // current-month totals when the user filters to a prior year
  // and (b) under-count once the user paginates past the first
  // 50 rows. The chip's label is a global "this month" fact and
  // must be independent of UI state.
  //
  // Expenses can be logged in different currencies, so sum
  // per-currency and render each group on its own — naively
  // summing across currencies would silently produce a wrong
  // KPI tiles above the form — Year-to-date / This month /
  // Last month / This quarter. One wide query pulls every row
  // since the earliest period start (covers the January edge
  // where last-month spans into the prior year), then JS buckets
  // each row into the four periods. Independent of the rendered
  // list query, so toggling row-level filters doesn't shift the
  // KPI numbers.
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth(); // 0-indexed
  const todayStr = `${todayY}-${pad2(todayM + 1)}-${pad2(now.getDate())}`;

  const ytdStart = `${todayY}-01-01`;

  const thisMonthStart = `${todayY}-${pad2(todayM + 1)}-01`;
  const nextMonthY = todayM === 11 ? todayY + 1 : todayY;
  const nextMonthM = todayM === 11 ? 1 : todayM + 2;
  const thisMonthEndExclusive = `${nextMonthY}-${pad2(nextMonthM)}-01`;
  const thisMonthEndInclusive = lastDateBefore(thisMonthEndExclusive);

  const lastMonthY = todayM === 0 ? todayY - 1 : todayY;
  const lastMonthM = todayM === 0 ? 12 : todayM;
  const lastMonthStart = `${lastMonthY}-${pad2(lastMonthM)}-01`;
  const lastMonthEndInclusive = lastDateBefore(thisMonthStart);

  const quarterStartM = Math.floor(todayM / 3) * 3 + 1; // 1, 4, 7, 10
  const quarterStart = `${todayY}-${pad2(quarterStartM)}-01`;
  const nextQuarterStartM = quarterStartM + 3;
  const nextQuarterY = nextQuarterStartM > 12 ? todayY + 1 : todayY;
  const nextQuarterM = nextQuarterStartM > 12 ? nextQuarterStartM - 12 : nextQuarterStartM;
  const quarterEndExclusive = `${nextQuarterY}-${pad2(nextQuarterM)}-01`;
  const quarterEndInclusive = lastDateBefore(quarterEndExclusive);

  // Widest start = min(ytdStart, lastMonthStart) — handles January
  // where last month is December of the prior year.
  const widestStart =
    lastMonthStart < ytdStart ? lastMonthStart : ytdStart;

  const { data: kpiRows } = await supabase
    .from("expenses")
    .select("amount, currency, incurred_on")
    .in("team_id", teamIds)
    .is("deleted_at", null)
    .gte("incurred_on", widestStart);

  const ytdByCurrency = new Map<string, number>();
  const monthByCurrency = new Map<string, number>();
  const lastMonthByCurrency = new Map<string, number>();
  const quarterByCurrency = new Map<string, number>();
  for (const row of kpiRows ?? []) {
    const code = ((row.currency as string | null) ?? "USD").toUpperCase();
    const amt = Number(row.amount);
    if (!Number.isFinite(amt)) continue;
    const d = row.incurred_on as string;
    if (d >= ytdStart && d <= todayStr) {
      ytdByCurrency.set(code, (ytdByCurrency.get(code) ?? 0) + amt);
    }
    if (d >= thisMonthStart && d < thisMonthEndExclusive) {
      monthByCurrency.set(code, (monthByCurrency.get(code) ?? 0) + amt);
    }
    if (d >= lastMonthStart && d < thisMonthStart) {
      lastMonthByCurrency.set(
        code,
        (lastMonthByCurrency.get(code) ?? 0) + amt,
      );
    }
    if (d >= quarterStart && d < quarterEndExclusive) {
      quarterByCurrency.set(code, (quarterByCurrency.get(code) ?? 0) + amt);
    }
  }

  // Recategorize callout: every CSV-imported expense lands in
  // category="other" by default. Surface a single soft banner when
  // the count is non-trivial AND no filter is active — when filters
  // are applied the banner becomes confusing ("39 in other" alongside
  // a filtered count of 5 makes the user wonder which is real). The
  // count itself comes from a separate full-table query so the
  // banner's accuracy doesn't depend on whether the user has
  // category=other filtered in.
  const filtersActive = hasActiveFilters(filters);
  let otherCount = 0;
  if (!filtersActive) {
    const { count } = await supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .in("team_id", teamIds)
      .is("deleted_at", null)
      .eq("category", "other");
    otherCount = count ?? 0;
  }

  // Import CSV link is owner|admin only — same gate as the
  // /business/[businessId]/expenses/import page itself, but checked
  // here to hide the entry point from members who would 404 on click.
  const canImport = Array.from(teamRoleById.values()).some(
    (r) => r === "owner" || r === "admin",
  );

  const totalCount = (allYearsRows ?? []).length;

  const periodTotals: PeriodTotal[] = [
    {
      key: "ytd",
      totalsByCurrency: ytdByCurrency,
      from: ytdStart,
      to: todayStr,
    },
    {
      key: "month",
      totalsByCurrency: monthByCurrency,
      from: thisMonthStart,
      to: thisMonthEndInclusive,
    },
    {
      key: "lastMonth",
      totalsByCurrency: lastMonthByCurrency,
      from: lastMonthStart,
      to: lastMonthEndInclusive,
    },
    {
      key: "quarter",
      totalsByCurrency: quarterByCurrency,
      from: quarterStart,
      to: quarterEndInclusive,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-body-lg font-semibold text-content">{t("title")}</span>
        <TableDensityToggle className="ml-auto" />
      </div>

      <ExpenseSummaryTiles
        periods={periodTotals}
        filters={filters}
        basePath={`/business/${businessId}/expenses`}
      />

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
          className="rounded-md border border-warning/40 bg-warning-soft/20 px-3 py-2 text-caption text-content-secondary flex items-start gap-3"
          role="status"
        >
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-warning">
              {t("recategorizeBanner.title", { count: otherCount })}
            </span>{" "}
            {t("recategorizeBanner.body")}
          </div>
          <Link
            href={`/business/${businessId}/expenses?category=other`}
            className={`${buttonSecondaryClass} shrink-0`}
          >
            {t("recategorizeBanner.cta", { count: otherCount })}
            <LinkPendingSpinner size={10} className="" />
          </Link>
        </div>
      )}

      <NewExpenseForm
        defaultTeamId={representativeTeamId}
        teamOptions={teamOptions}
        projects={projects}
        secondaryAction={
          <div className="flex items-center gap-2">
            <a
              href={buildExpensesCsvHref(businessId, filters)}
              download
              className={buttonSecondaryClass}
            >
              <Download size={16} />
              {t("exportCsv")}
            </a>
            {canImport && (
              <Link
                href={`/business/${businessId}/expenses/import`}
                className={buttonSecondaryClass}
              >
                <Upload size={16} />
                {t("importCsv")}
                <LinkPendingSpinner size={10} className="" />
              </Link>
            )}
          </div>
        }
      />

      <ExpenseFilters
        availableYears={availableYears}
        projects={projects}
        matchingCount={matchingCount ?? expenses.length}
        totalCount={totalCount}
      />

      <ExpensesTable
        expenses={expenses}
        projects={projects}
        authorById={authorById}
        teamRoleById={teamRoleById}
        teamNameById={teamNameById}
        showTeamColumn={showTeamColumn}
        viewerUserId={viewerUserId}
        totalCount={totalCount}
        hasFilter={filtersActive}
        matchingCount={matchingCount ?? expenses.length}
        filters={filters}
        businessId={businessId}
      />

      <PaginationFooter
        loaded={expenses.length}
        total={matchingCount ?? expenses.length}
      />

      {/* New users land on this page in compact density — post-CSV-import
          recategorize work is dense scanning. Once they touch the toggle,
          their choice persists and this nudge becomes a no-op. */}
      <TableDensityDefault preferred="compact" />
    </div>
  );
}

/** Build a CSV-export href from the active filter set. The export
 *  route now honors EVERY filter the page applies — q (free-text
 *  search), project, multi-category, billable, from/to. Earlier
 *  versions silently dropped q + project + multi-category, which
 *  meant "Travel · Q2 · Acme" filtered in the UI exported the
 *  whole business (bookkeeper / agency-owner blocking concern,
 *  fixed 2026-05-06). The route accepts the same param shape as
 *  the page's filter URL: `category` is comma-joined when the
 *  user selects multiple. */
function buildExpensesCsvHref(
  businessId: string,
  filters: {
    q: string;
    from: string | null;
    to: string | null;
    categories: string[];
    project: string | null;
    billable: boolean | null;
  },
): string {
  const sp = new URLSearchParams();
  if (filters.q) sp.set("q", filters.q);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.categories.length > 0) {
    sp.set("category", filters.categories.join(","));
  }
  if (filters.project !== null) sp.set("project", filters.project);
  if (filters.billable === true) sp.set("billable", "1");
  if (filters.billable === false) sp.set("billable", "0");
  const qs = sp.toString();
  return `/api/business/${businessId}/expenses/csv${qs ? `?${qs}` : ""}`;
}
