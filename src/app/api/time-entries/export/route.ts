import { createClient } from "@/lib/supabase/server";
import {
  getWeekRange,
  getTodayStart,
  parseWeekParam,
} from "@/lib/time/week";
import { toCsv, type CsvEntryRow } from "@/lib/time/csv";

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
      "start_time, end_time, duration_min, description, billable, github_issue, category_id, projects(name, customers(name)), categories(name)",
    )
    .is("deleted_at", null)
    .gte("start_time", rangeStart.toISOString())
    .lt("start_time", rangeEnd.toISOString())
    .order("start_time", { ascending: true });
  if (teamId) q = q.eq("team_id", teamId);
  if (billableOnly) q = q.eq("billable", true);

  const { data, error } = await q;
  if (error) {
    return new Response(`Export failed: ${error.message}`, { status: 500 });
  }

  const rows: CsvEntryRow[] = (data ?? []).map((row) => {
    const start = new Date(row.start_time);
    const end = row.end_time ? new Date(row.end_time) : null;
    const project = unwrapOne<{ name: string; customers: unknown }>(row.projects);
    const client = project ? unwrapOne<{ name: string }>(project.customers) : null;
    const category = unwrapOne<{ name: string }>(row.categories);

    return {
      date: toDateOnly(start),
      start: toTimeOnly(start),
      end: end ? toTimeOnly(end) : "",
      durationMin: row.duration_min,
      project: project?.name ?? "",
      client: client?.name ?? "",
      category: category?.name ?? "",
      description: row.description ?? "",
      billable: row.billable,
      githubIssue: row.github_issue,
    };
  });

  const csv = toCsv(rows);
  const filename = `shyre-time-${toDateOnly(rangeStart)}-to-${toDateOnly(
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
function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeOnly(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
