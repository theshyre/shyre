import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clock, Hash, ExternalLink } from "lucide-react";
import { cookies } from "next/headers";
import { Avatar, resolveAvatarUrl, formatDate } from "@theshyre/ui";
import { tableClass } from "@/lib/table-styles";
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
import { loadProject } from "../load-project";
import { BudgetMasthead } from "../budget-masthead";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  const t = await getTranslations("projects.sectionNav");
  return {
    title: `${t("time")} — ${(project.row.name as string | null) ?? ""}`,
  };
}

interface IssueTimeSummary {
  displayKey: string;
  url: string | null;
  bucketId: string;
  totalMinutes: number;
  entryCount: number;
}

interface AuthorEntry {
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * /projects/[id]/time — the "what got logged here" surface.
 * Includes the budget masthead at the top (relevant context when
 * scanning hours) and the time-by-ticket rollup when any entries
 * carry linked tickets.
 *
 * Author chip per row is non-conditional (time-entry-authorship
 * rule) — the previous monolith's Recent-Time-Entries strip
 * silently omitted it. Fixed in this restructure.
 */
export default async function ProjectTimePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const project = await loadProject(id);
  const supabase = await createClient();
  const t = await getTranslations("projects");
  const tTime = await getTranslations("projects.time");

  const { data: entries } = await supabase
    .from("time_entries")
    .select(
      "id, user_id, description, duration_min, start_time, billable, github_issue, linked_ticket_provider, linked_ticket_key, linked_ticket_url",
    )
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("start_time", { ascending: false });
  const allEntries = (entries ?? []) as Array<Record<string, unknown>>;

  // Author bulk fetch — one query for every distinct user_id.
  const userIds = Array.from(
    new Set(allEntries.map((e) => e.user_id as string)),
  );
  const authorById = new Map<string, AuthorEntry>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      authorById.set(p.user_id as string, {
        displayName: (p.display_name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    }
  }

  const totalMinutes = allEntries.reduce(
    (s, e) => s + ((e.duration_min as number | null) ?? 0),
    0,
  );

  // Per-currency expense totals for the masthead footer — fetched
  // independently of the time-entry query so it's clearly a side
  // signal rather than coupled to the time data on this page.
  const { data: expenseRows } = await supabase
    .from("expenses")
    .select("amount, currency")
    .eq("project_id", id)
    .is("deleted_at", null);
  const expenseTotalsRecord: Record<string, number> = {};
  for (const e of expenseRows ?? []) {
    const cur = (e.currency as string | null) ?? "USD";
    expenseTotalsRecord[cur] =
      (expenseTotalsRecord[cur] ?? 0) + Number(e.amount);
  }
  const expenseTotalsByCurrency =
    Object.keys(expenseTotalsRecord).length === 0
      ? null
      : expenseTotalsRecord;

  // TZ chain identical to Overview — masthead burn computation needs
  // the user's local "today" anchor.
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
        entries: allEntries.map((e) => ({
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
          allEntries.map((e) => ({
            start_time: e.start_time as string,
            duration_min: (e.duration_min as number | null) ?? null,
          })),
          bounds.startUtc,
          bounds.endUtc,
        );
      })()
    : null;

  const totalHours = (totalMinutes / 60).toFixed(1);

  // Time-by-ticket rollup — same bucketing as the old monolith,
  // moved here verbatim (the logic was correct; it just lived in
  // the wrong file).
  const projectRepo = project.row.github_repo as string | null;
  const issueMap = new Map<string, IssueTimeSummary>();
  for (const entry of allEntries) {
    let bucketId: string | null = null;
    let displayKey: string | null = null;
    let url: string | null = null;

    if (entry.linked_ticket_provider && entry.linked_ticket_key) {
      bucketId = `${entry.linked_ticket_provider}:${entry.linked_ticket_key}`;
      displayKey = entry.linked_ticket_key as string;
      url = (entry.linked_ticket_url as string | null) ?? null;
    } else if (entry.github_issue && projectRepo) {
      bucketId = `github:${projectRepo}#${entry.github_issue}`;
      displayKey = `${projectRepo}#${entry.github_issue}`;
      url = `https://github.com/${projectRepo}/issues/${entry.github_issue}`;
    } else if (entry.github_issue) {
      bucketId = `github_issue:${entry.github_issue}`;
      displayKey = `#${entry.github_issue}`;
      url = null;
    }

    if (!bucketId || !displayKey) continue;

    const existing = issueMap.get(bucketId);
    if (existing) {
      existing.totalMinutes += (entry.duration_min as number | null) ?? 0;
      existing.entryCount += 1;
      if (!existing.url && url) existing.url = url;
    } else {
      issueMap.set(bucketId, {
        bucketId,
        displayKey,
        url,
        totalMinutes: (entry.duration_min as number | null) ?? 0,
        entryCount: 1,
      });
    }
  }
  const issueSummaries = Array.from(issueMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes,
  );

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

      {issueSummaries.length > 0 && (
        <section aria-labelledby="project-time-by-ticket">
          <div className="flex items-center gap-3">
            <Hash size={20} className="text-accent" aria-hidden="true" />
            <h2
              id="project-time-by-ticket"
              className="text-title font-semibold text-content"
            >
              {tTime("byTicket.heading")}
            </h2>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
            <table className={tableClass}>
              <thead>
                <tr className="border-b border-edge bg-surface-inset">
                  <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                    {tTime("byTicket.ticket")}
                  </th>
                  <th className="px-4 py-3 text-right text-caption font-semibold uppercase tracking-wider text-content-muted">
                    {tTime("byTicket.entries")}
                  </th>
                  <th className="px-4 py-3 text-right text-caption font-semibold uppercase tracking-wider text-content-muted">
                    {tTime("byTicket.totalTime")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {issueSummaries.map((summary) => {
                  const h = Math.floor(summary.totalMinutes / 60);
                  const m = Math.round(summary.totalMinutes % 60);
                  const linkBody = (
                    <span className="inline-flex items-center gap-1.5 text-accent font-mono">
                      {summary.displayKey}
                      {summary.url && <ExternalLink size={12} aria-hidden="true" />}
                    </span>
                  );
                  return (
                    <tr
                      key={summary.bucketId}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        {summary.url ? (
                          <a
                            href={summary.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {linkBody}
                          </a>
                        ) : (
                          linkBody
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-content-secondary">
                        {summary.entryCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {h}h {m}m
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="project-time-list" className="mt-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-accent" aria-hidden="true" />
            <h2
              id="project-time-list"
              className="text-title font-semibold text-content"
            >
              {t("timeEntries.title")}
            </h2>
          </div>
          {totalMinutes > 0 && (
            <span className="text-body-lg font-mono text-content-secondary">
              {t("timeEntries.totalHours", { hours: totalHours })}
            </span>
          )}
        </div>

        {allEntries.length === 0 ? (
          <p className="mt-3 text-body-lg text-content-muted">
            {t("timeEntries.noEntries")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {allEntries.map((entry) => {
              const author = authorById.get(entry.user_id as string);
              const hours = entry.duration_min
                ? Math.floor((entry.duration_min as number) / 60)
                : 0;
              const mins = entry.duration_min
                ? (entry.duration_min as number) % 60
                : 0;
              const displayKey =
                (entry.linked_ticket_key as string | null) ??
                (entry.github_issue
                  ? `#${entry.github_issue}`
                  : null);
              return (
                <li
                  key={entry.id as string}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-raised px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {author ? (
                      <Avatar
                        avatarUrl={resolveAvatarUrl(
                          author.avatarUrl,
                          entry.user_id as string,
                        )}
                        displayName={author.displayName ?? ""}
                        size={20}
                      />
                    ) : null}
                    <span className="text-content truncate">
                      {(entry.description as string | null) ?? "—"}
                    </span>
                    {displayKey && (
                      <span className="text-caption font-mono text-accent shrink-0">
                        {displayKey}
                      </span>
                    )}
                    <span className="text-caption text-content-muted shrink-0">
                      {formatDate(entry.start_time as string)}
                    </span>
                  </div>
                  <span className="text-body-lg font-mono text-content-secondary shrink-0">
                    {entry.duration_min ? `${hours}h ${mins}m` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {allEntries.length > 0 && (
          <p className="mt-3 text-caption text-content-muted">
            <Link
              href={`/time-entries?project=${encodeURIComponent(id)}`}
              className="text-accent hover:underline"
            >
              {tTime("openInTimeEntries")}
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
