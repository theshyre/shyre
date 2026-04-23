import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import {
  validateHarvestCredentials,
  fetchHarvestClients,
  fetchHarvestProjects,
  fetchHarvestTimeEntries,
  fetchHarvestUsers,
} from "@/lib/harvest";
import {
  buildCustomerRow,
  buildProjectRow,
  buildTimeEntryRow,
  collectUniqueHarvestUsers,
  collectUniqueTaskNames,
  proposeDefaultUserMapping,
  HARVEST_CATEGORY_SET_NAME,
  type ImportContext,
  type UserMapChoice,
} from "@/lib/harvest-import-logic";
import { NextResponse } from "next/server";

type SBClient = Awaited<ReturnType<typeof createClient>>;

interface ImportRequestBody {
  token: string;
  accountId: string;
  /** Target Shyre team id. Named `organizationId` for back-compat with
   * the previous API shape; internally treated as team_id. */
  organizationId: string;
  action: "validate" | "preview" | "import";
  /** Only used on action=import. Harvest user id → Shyre user id /
   * "importer" / "skip". */
  userMapping?: Record<string, UserMapChoice>;
  /** Only used on action=import. From the preview response. */
  timeZone?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as ImportRequestBody;
  const { token, accountId, organizationId, action } = body;

  if (!token || !accountId || !organizationId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  // Role gate: owners and admins only. Previous route let any team
  // member trigger an import (SAL-009). Importing bulk-writes to
  // customers / projects / time_entries, which is an owner/admin-grade
  // action, not a member-grade one.
  let role: string;
  try {
    ({ role } = await validateTeamAccess(organizationId));
  } catch {
    return NextResponse.json(
      { error: "No access to this team" },
      { status: 403 },
    );
  }
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "Only team owners or admins can run imports." },
      { status: 403 },
    );
  }

  const opts = { token, accountId };

  if (action === "validate") {
    const result = await validateHarvestCredentials(opts);
    return NextResponse.json(result);
  }

  if (action === "preview") {
    try {
      const [company, customers, projects, timeEntries, harvestUsers] =
        await Promise.all([
          validateHarvestCredentials(opts),
          fetchHarvestClients(opts),
          fetchHarvestProjects(opts),
          fetchHarvestTimeEntries(opts),
          fetchHarvestUsers(opts),
        ]);

      if (!company.valid) {
        return NextResponse.json(
          { error: company.error ?? "Invalid credentials" },
          { status: 400 },
        );
      }

      // Suggest a default mapping by matching Harvest users to existing
      // Shyre team members via email / display_name. UI can override.
      const shyreMembers = await fetchTeamMembersForMapping(
        supabase,
        organizationId,
      );
      const defaultMapping = proposeDefaultUserMapping(
        harvestUsers,
        shyreMembers,
      );
      const uniqueUsers = collectUniqueHarvestUsers(timeEntries);

      return NextResponse.json({
        companyName: company.companyName ?? "",
        timeZone: company.timeZone ?? "UTC",
        customers: customers.length,
        projects: projects.length,
        timeEntries: timeEntries.length,
        categoryCount: collectUniqueTaskNames(timeEntries).length,
        customerNames: customers.slice(0, 10).map((c) => c.name),
        projectNames: projects.slice(0, 10).map((p) => p.name),
        harvestUsers: harvestUsers.map((u) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`.trim(),
          email: u.email,
          entryCount:
            uniqueUsers.find((x) => x.id === u.id)?.entryCount ?? 0,
        })),
        shyreMembers,
        defaultMapping,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch data" },
        { status: 500 },
      );
    }
  }

  if (action === "import") {
    try {
      const timeZone = body.timeZone ?? "UTC";
      const userMapping: Record<number, UserMapChoice> = {};
      for (const [k, v] of Object.entries(body.userMapping ?? {})) {
        userMapping[Number(k)] = v;
      }

      const ctx: ImportContext = {
        teamId: organizationId,
        importerUserId: user.id,
        importRunId: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
      };

      const [harvestClients, harvestProjects, harvestTimeEntries] =
        await Promise.all([
          fetchHarvestClients(opts),
          fetchHarvestProjects(opts),
          fetchHarvestTimeEntries(opts),
        ]);

      const errors: string[] = [];
      const customerMap = new Map<number, string>(); // Harvest id → Shyre id
      const projectMap = new Map<number, string>();
      const projectRateById = new Map<number, number | null>();

      // Customers ----------------------------------------------------
      let customersImported = 0;
      for (const hc of harvestClients) {
        if (!hc.is_active) continue;

        // Dedupe by import_source_id — survives name renames in Harvest.
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("team_id", organizationId)
          .eq("imported_from", "harvest")
          .eq("import_source_id", String(hc.id))
          .limit(1);

        if (existing && existing.length > 0) {
          customerMap.set(hc.id, existing[0]!.id);
          continue;
        }

        // Secondary dedupe by exact name — catches pre-audit-trail
        // imports that landed before source_id was populated.
        const { data: byName } = await supabase
          .from("customers")
          .select("id")
          .eq("team_id", organizationId)
          .eq("name", hc.name)
          .is("import_source_id", null)
          .limit(1);

        if (byName && byName.length > 0) {
          customerMap.set(hc.id, byName[0]!.id);
          continue;
        }

        const row = buildCustomerRow(hc, ctx);
        const { data: inserted, error } = await supabase
          .from("customers")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          errors.push(`Customer "${hc.name}": ${error.message}`);
          continue;
        }
        if (inserted) {
          customerMap.set(hc.id, inserted.id);
          customersImported++;
        }
      }

      // Projects -----------------------------------------------------
      let projectsImported = 0;
      for (const hp of harvestProjects) {
        projectRateById.set(hp.id, hp.hourly_rate);

        const { data: existing } = await supabase
          .from("projects")
          .select("id")
          .eq("team_id", organizationId)
          .eq("imported_from", "harvest")
          .eq("import_source_id", String(hp.id))
          .limit(1);

        if (existing && existing.length > 0) {
          projectMap.set(hp.id, existing[0]!.id);
          continue;
        }

        const { data: byName } = await supabase
          .from("projects")
          .select("id")
          .eq("team_id", organizationId)
          .eq("name", hp.name)
          .is("import_source_id", null)
          .limit(1);

        if (byName && byName.length > 0) {
          projectMap.set(hp.id, byName[0]!.id);
          continue;
        }

        const customerId = customerMap.get(hp.client.id) ?? null;
        const row = buildProjectRow(hp, customerId, ctx);
        const { data: inserted, error } = await supabase
          .from("projects")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          errors.push(`Project "${hp.name}": ${error.message}`);
          continue;
        }
        if (inserted) {
          projectMap.set(hp.id, inserted.id);
          projectsImported++;
        }
      }

      // Category set + per-task categories ---------------------------
      // One team-level "Harvest Tasks" set; one category per unique task
      // name the import touches. Entries get category_id set when the
      // task matches a category in the set.
      const categoryIdByTaskName = await upsertHarvestCategorySet(
        supabase,
        organizationId,
        user.id,
        harvestTimeEntries,
        ctx,
      );

      // Time entries -------------------------------------------------
      let timeEntriesImported = 0;
      let timeEntriesSkipped = 0;
      const skipReasons = new Map<string, number>();

      const okRows: Array<
        Exclude<
          ReturnType<typeof buildTimeEntryRow>,
          { skipped: true; reason: string }
        >
      > = [];

      for (const hte of harvestTimeEntries) {
        // Dedupe by source id.
        const built = buildTimeEntryRow({
          entry: hte,
          projectId: projectMap.get(hte.project.id) ?? null,
          projectHourlyRate: projectRateById.get(hte.project.id) ?? null,
          userMapping,
          categoryIdByTaskName,
          ctx,
          timeZone,
        });

        if ("skipped" in built) {
          timeEntriesSkipped++;
          skipReasons.set(built.reason, (skipReasons.get(built.reason) ?? 0) + 1);
          continue;
        }

        okRows.push(built);
      }

      // Batch insert with idempotency via the partial unique index.
      // Conflicts are pre-existing imports — count them as skipped
      // rather than erroring the whole batch.
      const BATCH_SIZE = 100;
      for (let i = 0; i < okRows.length; i += BATCH_SIZE) {
        const batch = okRows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("time_entries")
          .insert(batch);

        if (error) {
          // Duplicate-source-id hits the partial unique index; treat as
          // skipped (already imported).
          if (error.code === "23505") {
            timeEntriesSkipped += batch.length;
            skipReasons.set(
              "already imported",
              (skipReasons.get("already imported") ?? 0) + batch.length,
            );
          } else {
            errors.push(`Time entries batch: ${error.message}`);
          }
          continue;
        }
        timeEntriesImported += batch.length;
      }

      return NextResponse.json({
        success: true,
        importRunId: ctx.importRunId,
        imported: {
          customers: customersImported,
          projects: projectsImported,
          timeEntries: timeEntriesImported,
        },
        skipped: {
          timeEntries: timeEntriesSkipped,
          reasons: Object.fromEntries(skipReasons),
        },
        errors,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Import failed" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ────────────────────────────────────────────────────────────────
// Helpers — non-pure bits that wrap Supabase calls and belong here
// rather than in lib/harvest-import-logic.ts.
// ────────────────────────────────────────────────────────────────

async function fetchTeamMembersForMapping(
  supabase: SBClient,
  teamId: string,
): Promise<
  Array<{ user_id: string; email: string | null; display_name: string | null }>
> {
  const { data: members } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  const userIds = (members ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);

  const displayNameById = new Map<string, string | null>(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  // auth.users.email isn't available via the regular SSR client (RLS
  // on the auth schema). The import runs as an admin on the target
  // team; emails would be nice for matching but aren't required. For
  // now pass null — the mapper falls back to display-name matching.
  return userIds.map((id) => ({
    user_id: id,
    email: null,
    display_name: displayNameById.get(id) ?? null,
  }));
}

/**
 * Upsert the "Harvest Tasks" team-scoped category_set and one category
 * per unique Harvest task name referenced by the imported entries.
 * Returns a map from task-name → Shyre category id.
 */
async function upsertHarvestCategorySet(
  supabase: SBClient,
  teamId: string,
  userId: string,
  entries: Array<{ task: { id: number; name: string } }>,
  ctx: ImportContext,
): Promise<Map<string, string>> {
  const taskNames = collectUniqueTaskNames(entries);
  const result = new Map<string, string>();
  if (taskNames.length === 0) return result;

  // Find existing set by name; otherwise create.
  const { data: existingSet } = await supabase
    .from("category_sets")
    .select("id")
    .eq("team_id", teamId)
    .eq("name", HARVEST_CATEGORY_SET_NAME)
    .maybeSingle();

  let setId: string;
  if (existingSet) {
    setId = existingSet.id as string;
  } else {
    const { data: created, error } = await supabase
      .from("category_sets")
      .insert({
        team_id: teamId,
        project_id: null,
        name: HARVEST_CATEGORY_SET_NAME,
        description: "Imported from Harvest tasks.",
        is_system: false,
        created_by: userId,
        imported_from: "harvest",
        imported_at: ctx.importedAt,
        import_run_id: ctx.importRunId,
      })
      .select("id")
      .single();
    if (error || !created) return result;
    setId = created.id as string;
  }

  // Fetch existing categories under that set.
  const { data: existingCats } = await supabase
    .from("categories")
    .select("id, name")
    .eq("category_set_id", setId);
  const existingByName = new Map<string, string>(
    (existingCats ?? []).map((c) => [c.name as string, c.id as string]),
  );

  const toInsert = taskNames.filter((name) => !existingByName.has(name));
  if (toInsert.length > 0) {
    const rows = toInsert.map((name, idx) => ({
      category_set_id: setId,
      name,
      color: "#6b7280",
      sort_order: idx,
      imported_from: "harvest",
      imported_at: ctx.importedAt,
      import_run_id: ctx.importRunId,
    }));
    const { data: inserted } = await supabase
      .from("categories")
      .insert(rows)
      .select("id, name");
    for (const row of inserted ?? []) {
      existingByName.set(row.name as string, row.id as string);
    }
  }

  for (const name of taskNames) {
    const id = existingByName.get(name);
    if (id) result.set(name, id);
  }
  return result;
}

