import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clock, Receipt, ChevronRight } from "lucide-react";
import { cookies } from "next/headers";
import { Avatar, resolveAvatarUrl, formatDate } from "@theshyre/ui";
import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/user-settings";
import {
  TZ_COOKIE_NAME,
  parseTzOffset,
  getLocalToday,
  getOffsetForZone,
} from "@/lib/time/tz";
import {
  computeProjectPeriodBurn,
  computePreviousPeriodBounds,
  sumMinutesInPeriod,
  type BudgetPeriod,
} from "@/lib/projects/budget-period";
import {
  formatExpenseAmount,
  formatExpenseDateDisplay,
} from "@/lib/expenses/format-helpers";
import { loadProject } from "./load-project";
import { BudgetMasthead } from "./budget-masthead";
import { SubProjectsSection } from "./sub-projects-section";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  return { title: (project.row.name as string | null) ?? "Project" };
}

interface ActivityAuthor {
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Project Overview — "is this project healthy?" glance.
 *
 * Renders (in scan order):
 *   1. Budget masthead (period burn + lifetime + per-currency
 *      expense footer)
 *   2. Sub-projects rollup, when the project has children
 *   3. Recent activity strip — last 5 time entries + last 3
 *      expenses, each linking to their full sub-route. Author
 *      avatars on every row per the time-entry-authorship rule.
 *   4. Section nav tiles with live counts (defensible cardinality:
 *      Time entries / Expenses) so the user sees scale before
 *      clicking through.
 *
 * Everything else (full time list, full expenses, settings form,
 * categories editor, classification) lives at the dedicated
 * sub-routes the section nav exposes.
 */
export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const project = await loadProject(id);
  const supabase = await createClient();
  const tOv = await getTranslations("projects.overview");

  const children = await loadChildren(id);
  const timeEntries = await loadTimeEntries(id);
  const expenses = await loadExpenses(id);

  const totalMinutes = timeEntries.reduce(
    (s, e) => s + ((e.duration_min as number | null) ?? 0),
    0,
  );

  // Authors for the activity strip — one bulk query for both time
  // entries and expenses keeps the page to ≤5 round-trips total.
  const activityUserIds = Array.from(
    new Set([
      ...timeEntries.slice(0, 5).map((e) => e.user_id as string),
      ...expenses.slice(0, 3).map((e) => e.user_id as string),
    ]),
  );
  const authorById = new Map<string, ActivityAuthor>();
  if (activityUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", activityUserIds);
    for (const p of profiles ?? []) {
      authorById.set(p.user_id as string, {
        displayName: (p.display_name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    }
  }

  // TZ resolution for the masthead's period bounds — same chain
  // the original page used.
  const cookieStore = await cookies();
  const cookieOffset = parseTzOffset(cookieStore.get(TZ_COOKIE_NAME)?.value);
  const userSettings = await getUserSettings();
  const tzOffsetMin = userSettings.timezone
    ? getOffsetForZone(userSettings.timezone, new Date())
    : cookieOffset;
  const todayLocal = getLocalToday(tzOffsetMin);

  const projectBudgetPeriod =
    (project.row.budget_period as BudgetPeriod | null) ?? null;
  const projectRate = (project.row.hourly_rate as number | null) ?? null;
  const periodBurn = projectBudgetPeriod
    ? computeProjectPeriodBurn({
        budget_period: projectBudgetPeriod,
        budget_hours_per_period:
          (project.row.budget_hours_per_period as number | null) ?? null,
        budget_dollars_per_period:
          (project.row.budget_dollars_per_period as number | null) ?? null,
        budget_alert_threshold_pct:
          (project.row.budget_alert_threshold_pct as number | null) ?? null,
        effectiveRate: projectRate,
        entries: timeEntries.map((e) => ({
          start_time: e.start_time as string,
          duration_min: (e.duration_min as number | null) ?? null,
        })),
        anchorLocalDate: todayLocal,
        tzOffsetMin,
      })
    : null;
  const previousPeriodMinutes = projectBudgetPeriod
    ? (() => {
        const bounds = computePreviousPeriodBounds(
          projectBudgetPeriod,
          todayLocal,
          tzOffsetMin,
        );
        return sumMinutesInPeriod(
          timeEntries.map((e) => ({
            start_time: e.start_time as string,
            duration_min: (e.duration_min as number | null) ?? null,
          })),
          bounds.startUtc,
          bounds.endUtc,
        );
      })()
    : null;

  // Per-currency expense totals for the masthead footer (money-UI
  // rule: no cross-currency sums).
  const expenseTotalsRecord: Record<string, number> = {};
  for (const e of expenses) {
    const cur = (e.currency as string | null) ?? "USD";
    expenseTotalsRecord[cur] =
      (expenseTotalsRecord[cur] ?? 0) + Number(e.amount);
  }
  const expenseTotalsByCurrency =
    Object.keys(expenseTotalsRecord).length === 0
      ? null
      : expenseTotalsRecord;

  const recentEntries = timeEntries.slice(0, 5);
  const recentExpenses = expenses.slice(0, 3);

  return (
    <div className="space-y-6">
      <BudgetMasthead
        projectId={id}
        lifetimeMinutes={totalMinutes}
        lifetimeBudgetHours={
          (project.row.budget_hours as number | null) ?? null
        }
        lifetimeRate={projectRate}
        lifetimeBudgetDollars={null}
        period={
          periodBurn && projectBudgetPeriod
            ? {
                type: projectBudgetPeriod,
                startLocal: periodBurn.bounds.startLocal,
                endLocal: periodBurn.bounds.endLocal,
                minutes: periodBurn.minutes,
                capHours: periodBurn.capHours,
                capDollars: periodBurn.capDollars,
                rate: projectRate,
                alertThresholdPct:
                  (project.row.budget_alert_threshold_pct as
                    | number
                    | null) ?? null,
                alertActive: periodBurn.alertActive,
                previousMinutes: previousPeriodMinutes,
              }
            : null
        }
        expenseTotalsByCurrency={expenseTotalsByCurrency}
      />

      {children.length > 0 && (
        <SubProjectsSection
          parentId={id}
          parentBudgetHours={
            (project.row.budget_hours as number | null) ?? null
          }
          parentHourlyRate={projectRate}
          parentOwnMinutes={totalMinutes}
          subProjects={children}
        />
      )}

      {/* Recent activity — two-column strip on wide layouts so a
          glance shows both "what time landed" and "what got spent".
          Each row links out to the full sub-route. */}
      <section
        aria-labelledby="project-overview-activity"
        className="grid gap-4 lg:grid-cols-2"
      >
        <div className="rounded-lg border border-edge bg-surface-raised">
          <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-edge">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-accent" aria-hidden="true" />
              <h2
                id="project-overview-activity"
                className="text-label font-semibold uppercase tracking-wider text-content-muted"
              >
                {tOv("recentTime.title")}
              </h2>
            </div>
            <Link
              href={`/projects/${id}/time`}
              className="text-caption text-accent hover:underline inline-flex items-center gap-0.5"
            >
              {tOv("recentTime.viewAll", { count: timeEntries.length })}
              <ChevronRight size={12} aria-hidden="true" />
            </Link>
          </header>
          {recentEntries.length === 0 ? (
            <p className="p-4 text-body text-content-muted">
              {tOv("recentTime.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-edge-muted">
              {recentEntries.map((entry) => {
                const author = authorById.get(entry.user_id as string);
                const hours = entry.duration_min
                  ? Math.floor((entry.duration_min as number) / 60)
                  : 0;
                const mins = entry.duration_min
                  ? (entry.duration_min as number) % 60
                  : 0;
                return (
                  <li
                    key={entry.id as string}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    {author && (
                      <Avatar
                        avatarUrl={resolveAvatarUrl(
                          author.avatarUrl,
                          entry.user_id as string,
                        )}
                        displayName={author.displayName ?? ""}
                        size={20}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-body text-content truncate">
                        {(entry.description as string | null) ??
                          tOv("recentTime.noDescription")}
                      </p>
                      <p className="text-caption text-content-muted">
                        {formatDate(entry.start_time as string)}
                      </p>
                    </div>
                    <span className="text-body font-mono tabular-nums text-content-secondary shrink-0">
                      {entry.duration_min ? `${hours}h ${mins}m` : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-edge bg-surface-raised">
          <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-edge">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-accent" aria-hidden="true" />
              <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
                {tOv("recentExpenses.title")}
              </h2>
            </div>
            <Link
              href={`/projects/${id}/expenses`}
              className="text-caption text-accent hover:underline inline-flex items-center gap-0.5"
            >
              {tOv("recentExpenses.viewAll", { count: expenses.length })}
              <ChevronRight size={12} aria-hidden="true" />
            </Link>
          </header>
          {recentExpenses.length === 0 ? (
            <p className="p-4 text-body text-content-muted">
              {tOv("recentExpenses.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-edge-muted">
              {recentExpenses.map((expense) => {
                const author = authorById.get(expense.user_id as string);
                return (
                  <li
                    key={expense.id as string}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    {author && (
                      <Avatar
                        avatarUrl={resolveAvatarUrl(
                          author.avatarUrl,
                          expense.user_id as string,
                        )}
                        displayName={author.displayName ?? ""}
                        size={20}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-body text-content truncate">
                        {(expense.vendor as string | null) ??
                          (expense.category as string)}
                      </p>
                      <p className="text-caption text-content-muted">
                        {formatExpenseDateDisplay(
                          expense.incurred_on as string,
                        )}
                      </p>
                    </div>
                    <span className="text-body font-mono tabular-nums text-content shrink-0">
                      {formatExpenseAmount(
                        Number(expense.amount),
                        (expense.currency as string | null) ?? "USD",
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

    </div>
  );
}

async function loadChildren(
  parentId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    status: string | null;
    budget_hours: number | null;
    hourly_rate: number | null;
  }>
> {
  const supabase = await createClient();
  const { data: childRows } = await supabase
    .from("projects_v")
    .select("id, name, status, budget_hours, hourly_rate")
    .eq("parent_project_id", parentId)
    .order("name");
  return (childRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    status: (c.status as string | null) ?? null,
    budget_hours: (c.budget_hours as number | null) ?? null,
    hourly_rate: (c.hourly_rate as number | null) ?? null,
  }));
}

async function loadTimeEntries(projectId: string): Promise<
  Array<Record<string, unknown>>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_entries")
    .select("id, user_id, description, duration_min, start_time")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("start_time", { ascending: false });
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function loadExpenses(projectId: string): Promise<
  Array<Record<string, unknown>>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("expenses")
    .select("id, user_id, incurred_on, amount, currency, vendor, category")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("incurred_on", { ascending: false });
  return (data ?? []) as Array<Record<string, unknown>>;
}
