/**
 * Seed Shyre's own internal time log into Shyre's database.
 *
 * Reads docs/company/time-log.csv and inserts time_entries on a
 * dedicated "Shyre" project owned by Marcus's primary team. The
 * project is owned by the team but has no customer (it's
 * internal R&D, like Liv's "Liv" self-tracking project).
 *
 * Idempotent: every inserted row is linked to a singleton
 * `import_runs` row with `imported_from = 'csv-company-time-log'`
 * for the team. Re-running the script first deletes all rows
 * carrying that import_run_id, then re-inserts from the CSV.
 * Manual entries on the same project are untouched.
 *
 * Earlier versions of this script used a `[seed:company-time-log]`
 * prefix in `description` as the sentinel. That marker leaked
 * onto user-facing time-entry views. The cleanup script
 * (`scripts/cleanup-company-time-log-prefix.ts`) backfilled
 * import_run_id + imported_from on those legacy rows and stripped
 * the prefix; this script picks up where that left off.
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   NEXT_PUBLIC_SUPABASE_URL=<url> \
 *   npx tsx scripts/seed-company-time-log.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OWNER_EMAIL = "marcus@malcom.io";
const SEED_PROJECT_NAME = "Shyre";
const IMPORT_KIND = "csv-company-time-log";
const CATEGORY_SET_NAME = "Product Development";
const CSV_PATH = resolve(__dirname, "../docs/company/time-log.csv");

interface CsvRow {
  date: string;
  contributor: string;
  hours: number;
  rate: number;
  category: string;
  description: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [header, ...rest] = lines;
  if (!header) throw new Error("Empty CSV");
  const cols = header.split(",").map((c) => c.trim());
  const required = ["date", "contributor", "hours", "rate", "category", "description"];
  for (const r of required) {
    if (!cols.includes(r)) throw new Error(`Missing column: ${r}`);
  }

  const rows: CsvRow[] = [];
  for (const line of rest) {
    const fields = splitCsvLine(line);
    if (fields.length < cols.length) continue;
    const get = (name: string) => fields[cols.indexOf(name)] ?? "";
    rows.push({
      date: get("date"),
      contributor: get("contributor"),
      hours: Number(get("hours")),
      rate: Number(get("rate")),
      category: get("category"),
      description: get("description"),
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * For each (date, description) pair we insert a single time_entry.
 * Multiple CSV rows on the same date with the same description get
 * folded into one row with summed hours.
 *
 * start_time defaults to 09:00 local; we space same-day entries by
 * sequential offsets so they don't all collide on the same instant.
 * The actual minute is unimportant — only `date` is queried at the
 * day-grain in week and report views.
 */
function buildStartTime(date: string, indexInDay: number): string {
  const baseHour = 9;
  const offsetMin = indexInDay * 5;
  const hh = String(baseHour + Math.floor(offsetMin / 60)).padStart(2, "0");
  const mm = String(offsetMin % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00.000Z`;
}

function buildEndTime(startIso: string, hours: number): string {
  const t = new Date(startIso).getTime() + hours * 60 * 60 * 1000;
  return new Date(t).toISOString();
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve the owner user via auth.admin.listUsers — auth.users
  // is not exposed through PostgREST, so the admin API is the only
  // way to look up by email. Pages until we find the match.
  let userId: string | null = null;
  let page = 1;
  const PAGE_SIZE = 200;
  while (!userId) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    if (error) {
      throw new Error(`auth.admin.listUsers failed: ${error.message}`);
    }
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === OWNER_EMAIL.toLowerCase(),
    );
    if (match) {
      userId = match.id;
      break;
    }
    if (data.users.length < PAGE_SIZE) break;
    page++;
  }

  if (!userId) {
    throw new Error(
      `Could not find auth user for ${OWNER_EMAIL}. ` +
        `Sign in to Shyre at least once before running this script.`,
    );
  }

  // Resolve the team. The owner's first owned team is the dogfood
  // home — typically "Malcom IO" — matching how the app picks the
  // default team after sign-in. Order by joined_at (NOT created_at —
  // team_members uses joined_at, see migration 002_multi_tenant.sql).
  const { data: membership, error: memErr } = await supabase
    .from("team_members")
    .select("team_id, role, teams(id, name)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memErr) {
    throw new Error(
      `Failed to look up owned teams for ${OWNER_EMAIL}: ${memErr.message}`,
    );
  }
  if (!membership) {
    throw new Error(
      `Could not find an owned team for ${OWNER_EMAIL}. Create a team first.`,
    );
  }

  const teamId = membership.team_id as string;
  const teamName =
    (membership.teams as { name?: string } | null)?.name ?? "(unknown)";

  // Resolve the Product Development system category set + its
  // seven categories. Required before the project insert so we can
  // attach the set on creation; the trigger that validates a time
  // entry's category_id refuses inserts if the project's
  // category_set_id is null.
  const { data: categorySet, error: setErr } = await supabase
    .from("category_sets")
    .select("id, name")
    .eq("name", CATEGORY_SET_NAME)
    .eq("is_system", true)
    .is("team_id", null)
    .is("project_id", null)
    .maybeSingle();

  if (setErr || !categorySet) {
    throw new Error(
      `System category set "${CATEGORY_SET_NAME}" not found. ` +
        `Run pending migrations first ` +
        `(supabase/migrations/*time_categories_product_development.sql).`,
    );
  }
  const categorySetId = categorySet.id as string;

  const { data: categoryRows, error: catErr } = await supabase
    .from("categories")
    .select("id, name")
    .eq("category_set_id", categorySetId);

  if (catErr || !categoryRows || categoryRows.length === 0) {
    throw new Error(
      `Could not load categories for "${CATEGORY_SET_NAME}": ${catErr?.message ?? "no rows"}`,
    );
  }

  // Case-insensitive lookup so the CSV's lowercase ("engineering")
  // matches the DB's title case ("Engineering").
  const categoryByName = new Map<string, string>();
  for (const c of categoryRows) {
    categoryByName.set(
      (c.name as string).toLowerCase(),
      c.id as string,
    );
  }

  // Find or create the seed project. Either way, ensure
  // category_set_id is wired to Product Development so the
  // category-validation trigger accepts the entries.
  const { data: existingProject } = await supabase
    .from("projects")
    .select("id, name, category_set_id")
    .eq("team_id", teamId)
    .eq("name", SEED_PROJECT_NAME)
    .maybeSingle();

  let projectId: string;
  if (existingProject) {
    projectId = existingProject.id as string;
    if ((existingProject.category_set_id as string | null) !== categorySetId) {
      const { error: updateErr } = await supabase
        .from("projects")
        .update({ category_set_id: categorySetId })
        .eq("id", projectId);
      if (updateErr) {
        throw new Error(
          `Failed to attach Product Development set to existing project: ${updateErr.message}`,
        );
      }
    }
  } else {
    const { data: created, error: createErr } = await supabase
      .from("projects")
      .insert({
        team_id: teamId,
        user_id: userId,
        name: SEED_PROJECT_NAME,
        description:
          "Internal R&D and dogfooding work on Shyre itself. Seeded from docs/company/time-log.csv.",
        status: "active",
        customer_id: null,
        hourly_rate: 150,
        category_set_id: categorySetId,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      throw new Error(`Failed to create seed project: ${createErr?.message}`);
    }
    projectId = created.id as string;
  }

  // Find or create the singleton import_run that anchors this seed.
  // Reusing one record across re-runs keeps /import history from
  // bloating with one row per re-seed; the same record's `summary`
  // gets refreshed on each run.
  let importRunId: string;
  const { data: existingRun } = await supabase
    .from("import_runs")
    .select("id")
    .eq("team_id", teamId)
    .eq("imported_from", IMPORT_KIND)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingRun) {
    importRunId = existingRun.id as string;
  } else {
    const { data: created, error: runErr } = await supabase
      .from("import_runs")
      .insert({
        team_id: teamId,
        triggered_by_user_id: userId,
        imported_from: IMPORT_KIND,
        status: "completed",
        completed_at: new Date().toISOString(),
        summary: {
          source: "docs/company/time-log.csv",
          purpose: "Internal R&D / dogfood time log.",
        },
      })
      .select("id")
      .single();
    if (runErr || !created) {
      throw new Error(`Failed to create import_run: ${runErr?.message}`);
    }
    importRunId = created.id as string;
  }

  // Wipe previously seeded rows so re-runs converge instead of
  // stacking. Scoped to import_run_id so manual entries on the
  // same project are untouched. (Earlier versions used a
  // description-prefix LIKE filter for this — see header doc.)
  const { error: wipeErr } = await supabase
    .from("time_entries")
    .delete()
    .eq("team_id", teamId)
    .eq("import_run_id", importRunId);

  if (wipeErr) {
    throw new Error(`Failed to wipe prior seed entries: ${wipeErr.message}`);
  }

  const csv = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(csv);

  // Group rows by date so we can space same-day entries cleanly.
  const byDate = new Map<string, CsvRow[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  const inserts: Array<{
    user_id: string;
    team_id: string;
    project_id: string;
    category_id: string | null;
    description: string;
    start_time: string;
    end_time: string;
    billable: boolean;
    import_run_id: string;
    imported_from: string;
    imported_at: string;
  }> = [];

  const importedAt = new Date().toISOString();

  const unmappedCategories = new Set<string>();

  for (const [date, dayRows] of byDate) {
    dayRows.forEach((r, idx) => {
      const startIso = buildStartTime(date, idx);
      const endIso = buildEndTime(startIso, r.hours);
      const categoryId =
        categoryByName.get(r.category.toLowerCase()) ?? null;
      if (!categoryId) unmappedCategories.add(r.category);
      inserts.push({
        user_id: userId,
        team_id: teamId,
        project_id: projectId,
        category_id: categoryId,
        description: r.description,
        start_time: startIso,
        end_time: endIso,
        billable: false,
        import_run_id: importRunId,
        imported_from: IMPORT_KIND,
        imported_at: importedAt,
      });
    });
  }

  if (unmappedCategories.size > 0) {
    throw new Error(
      `CSV uses categories not present in the "${CATEGORY_SET_NAME}" set: ` +
        `${Array.from(unmappedCategories).join(", ")}. Add the missing ` +
        `categories to the migration or fix the CSV.`,
    );
  }

  if (inserts.length === 0) {
    console.log("No CSV rows to insert.");
    return;
  }

  // Chunk inserts so a single oversized batch doesn't hit row limits.
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    const { error: insertErr, count } = await supabase
      .from("time_entries")
      .insert(slice, { count: "exact" });
    if (insertErr) {
      throw new Error(`Insert failed at batch ${i}: ${insertErr.message}`);
    }
    inserted += count ?? slice.length;
  }

  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);
  console.log(
    `Seeded ${inserted} time entries on project "${SEED_PROJECT_NAME}" ` +
      `(team: ${teamName}) — ${totalHours.toFixed(1)} hours total ` +
      `across ${byDate.size} days.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
