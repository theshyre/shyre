import { createClient } from "@/lib/supabase/server";
import {
  getWeekRange,
  getTodayStart,
  parseWeekParam,
} from "@/lib/time/week";
import { toCsv, type CsvEntryRow } from "@/lib/time/csv";
import { logError } from "@/lib/logger";

/**
 * GET /api/time-entries/export
 *
 * Exports the current time home's filtered view as CSV. Honors the same
 * query params as the page: interval, anchor/from/to, org, billable.
 *
 * Authentication/authorization is enforced via RLS — the session user's
 * Supabase client is used, so non-readable entries are silently excluded.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const teamId = url.searchParams.get("team") ?? undefined;
  const billableOnly = url.searchParams.get("billable") === "1";
  const view = url.searchParams.get("view") === "day" ? "day" : "week";
  const anchor =
    parseWeekParam(url.searchParams.get("anchor") ?? undefined) ??
    getTodayStart();

  // Resolve range by view
  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = new Date(anchor);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
  } else {
    const w = getWeekRange(anchor);
    rangeStart = w.start;
    rangeEnd = w.end;
  }

  let q = supabase
    .from("time_entries")
    .select(
      "id, user_id, team_id, project_id, invoice_id, start_time, end_time, duration_min, description, billable, github_issue, linked_ticket_provider, linked_ticket_key, category_id, projects(name, customer_id, budget_period, budget_hours_per_period, budget_dollars_per_period, customers(name)), categories(name, category_sets(name))",
    )
    .is("deleted_at", null)
    .gte("start_time", rangeStart.toISOString())
    .lt("start_time", rangeEnd.toISOString())
    .order("start_time", { ascending: true });
  if (teamId) q = q.eq("team_id", teamId);
  if (billableOnly) q = q.eq("billable", true);

  const { data, error } = await q;
  if (error) {
    logError(error, {
      userId: user.id,
      teamId,
      url: "/api/time-entries/export",
      action: "exportTimeEntries",
    });
    return new Response("Export failed", { status: 500 });
  }

  // Resolve display names for the userName column. RLS on
  // user_profiles is "any authenticated", so a simple .in() works
  // for any user_id in the result.
  const userIds = Array.from(
    new Set((data ?? []).map((row) => row.user_id as string)),
  );
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles, error: profilesErr } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    if (profilesErr) {
      logError(profilesErr, {
        userId: user.id,
        teamId,
        url: "/api/time-entries/export",
        action: "exportTimeEntries.profiles",
      });
    } else {
      for (const p of profiles ?? []) {
        nameById.set(
          p.user_id as string,
          (p.display_name as string) ?? "",
        );
      }
    }
  }

  const rows: CsvEntryRow[] = (data ?? []).map((row) => {
    const start = new Date(row.start_time);
    const end = row.end_time ? new Date(row.end_time) : null;
    const project = unwrapOne<{
      name: string;
      customer_id: string | null;
      customers: unknown;
      budget_period: string | null;
      budget_hours_per_period: number | string | null;
      budget_dollars_per_period: number | string | null;
    }>(row.projects);
    const client = project ? unwrapOne<{ name: string }>(project.customers) : null;
    const category = unwrapOne<{ name: string; category_sets: unknown }>(row.categories);
    const categorySet = category
      ? unwrapOne<{ name: string }>(category.category_sets)
      : null;

    // Fold the unified linked_ticket_* columns into the legacy
    // githubIssue column so existing bookkeeper templates keep
    // working: when the linked ticket is a GitHub issue, derive its
    // numeric id and surface it there. New entries don't write
    // github_issue directly anymore — this is the only path that
    // populates it for the CSV.
    const provider =
      (row.linked_ticket_provider as "jira" | "github" | null) ?? null;
    const ticketKey = (row.linked_ticket_key as string | null) ?? null;
    let derivedGithubIssue = row.github_issue as number | null;
    if (provider === "github" && ticketKey) {
      const m = ticketKey.match(/#(\d+)$/);
      if (m) derivedGithubIssue = parseInt(m[1]!, 10);
    }

    return {
      date: toUtcDateOnly(start),
      start: toUtcTimeOnly(start),
      end: end ? toUtcTimeOnly(end) : "",
      durationMin: row.duration_min,
      project: project?.name ?? "",
      client: client?.name ?? "",
      category: category?.name ?? "",
      categorySet: categorySet?.name ?? "",
      periodBudgetPeriod: project?.budget_period ?? "",
      periodBudgetHoursCap:
        project?.budget_hours_per_period != null
          ? String(project.budget_hours_per_period)
          : "",
      periodBudgetDollarsCap:
        project?.budget_dollars_per_period != null
          ? String(project.budget_dollars_per_period)
          : "",
      description: row.description ?? "",
      billable: row.billable,
      githubIssue: derivedGithubIssue,
      ticketKey: ticketKey ?? "",
      ticketProvider: provider ?? "",
      startIso: start.toISOString(),
      endIso: end ? end.toISOString() : "",
      entryId: row.id as string,
      userId: row.user_id as string,
      userName: nameById.get(row.user_id as string) ?? "",
      teamId: row.team_id as string,
      projectId: (row.project_id as string | null) ?? "",
      customerId: (project?.customer_id as string | null) ?? "",
      invoiceId: (row.invoice_id as string | null) ?? "",
      invoiced: row.invoice_id != null,
    };
  });

  const csv = toCsv(rows);
  const filename = `shyre-time-${toUtcDateOnly(rangeStart)}-to-${toUtcDateOnly(
    new Date(rangeEnd.getTime() - 1),
  )}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toUtcDateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function toUtcTimeOnly(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Supabase's type inference returns arrays for nested selects even when the
 * relationship yields a single row. This unwraps single-row arrays to the
 * underlying object so downstream code can read `.name` directly.
 */
function unwrapOne<T>(value: unknown): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}
