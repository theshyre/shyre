/**
 * One-shot cleanup of the `[seed:company-time-log]` description
 * prefix that ended up visible on user-facing time-entry views.
 *
 * Background: the original seed script (`scripts/seed-company-time-log.ts`)
 * marked every inserted row with a sentinel prefix in `description`
 * so re-runs could find and delete prior rows by `description LIKE
 * '[seed:company-time-log]%'`. That marker leaked onto the /time-entries
 * page where it read as test data the user didn't recognize.
 *
 * This script:
 *   1. Resolves the owner's primary owned team (same logic as the
 *      seed script — earliest-joined team where role='owner').
 *   2. Find-or-creates an `import_runs` row with
 *      `imported_from = 'csv-company-time-log'` for that team. The
 *      seed script will reuse this exact row going forward as its
 *      idempotency anchor.
 *   3. Backfills `import_run_id` + `imported_from` on every existing
 *      time_entry whose description starts with the marker.
 *   4. Strips the `[seed:company-time-log] ` prefix from those
 *      descriptions in the same UPDATE.
 *
 * Idempotent: a second run finds zero matching rows and exits with
 * "nothing to clean."
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   NEXT_PUBLIC_SUPABASE_URL=<url> \
 *   npx tsx scripts/cleanup-company-time-log-prefix.ts
 */

import { createClient } from "@supabase/supabase-js";

const OWNER_EMAIL = "marcus@malcom.io";
const SEED_MARKER = "[seed:company-time-log]";
const IMPORT_KIND = "csv-company-time-log";

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

  // Resolve owner user.
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
    throw new Error(`Could not find auth user for ${OWNER_EMAIL}.`);
  }

  // Resolve team.
  const { data: membership, error: memErr } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memErr || !membership) {
    throw new Error(
      `Could not find an owned team for ${OWNER_EMAIL}: ${memErr?.message ?? "no rows"}`,
    );
  }
  const teamId = membership.team_id as string;

  // How many rows still carry the prefix?
  const { count: matchCount, error: countErr } = await supabase
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .like("description", `${SEED_MARKER}%`);
  if (countErr) {
    throw new Error(`Count failed: ${countErr.message}`);
  }
  if (!matchCount || matchCount === 0) {
    console.log(
      `Nothing to clean — no time_entries on team ${teamId} carry the "${SEED_MARKER}" prefix.`,
    );
    return;
  }
  console.log(
    `Found ${matchCount} prefixed time_entries on team ${teamId}. Cleaning…`,
  );

  // Find or create the singleton import_run that will own these rows
  // going forward. Reusing one row across re-runs keeps /import
  // history from bloating with one entry per re-seed.
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
    console.log(`Reusing existing import_run ${importRunId}.`);
  } else {
    const { data: created, error: createErr } = await supabase
      .from("import_runs")
      .insert({
        team_id: teamId,
        triggered_by_user_id: userId,
        imported_from: IMPORT_KIND,
        status: "completed",
        completed_at: new Date().toISOString(),
        summary: {
          source: "docs/company/time-log.csv",
          purpose:
            "Internal R&D / dogfood time log. Seeded via scripts/seed-company-time-log.ts.",
        },
      })
      .select("id")
      .single();
    if (createErr || !created) {
      throw new Error(`Failed to create import_run: ${createErr?.message}`);
    }
    importRunId = created.id as string;
    console.log(`Created new import_run ${importRunId}.`);
  }

  // Pull every prefixed row's id + raw description so we can compute
  // the stripped value per-row in JS. Postgres has no portable
  // string-replace expression in the .update() builder, so we update
  // in chunks with explicit values.
  const PAGE = 500;
  let cleaned = 0;
  let from = 0;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from("time_entries")
      .select("id, description")
      .eq("team_id", teamId)
      .like("description", `${SEED_MARKER}%`)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (pageErr) throw new Error(`Page fetch failed: ${pageErr.message}`);
    if (!page || page.length === 0) break;

    for (const row of page) {
      const desc = (row.description as string | null) ?? "";
      // Strip the marker plus the single space that follows. Tolerant
      // of a missing space (legacy rows) — stripPrefix only takes the
      // exact marker length when the trailing space is absent.
      const stripped = desc.startsWith(`${SEED_MARKER} `)
        ? desc.slice(SEED_MARKER.length + 1)
        : desc.startsWith(SEED_MARKER)
          ? desc.slice(SEED_MARKER.length).replace(/^\s+/, "")
          : desc;
      const { error: upErr } = await supabase
        .from("time_entries")
        .update({
          description: stripped || null,
          import_run_id: importRunId,
          imported_from: IMPORT_KIND,
          imported_at: new Date().toISOString(),
        })
        .eq("id", row.id as string);
      if (upErr) {
        throw new Error(
          `Update failed on time_entry ${row.id as string}: ${upErr.message}`,
        );
      }
      cleaned++;
    }

    if (page.length < PAGE) break;
    from += PAGE;
  }

  console.log(
    `Cleaned ${cleaned} time_entries. Linked to import_run ${importRunId}.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
