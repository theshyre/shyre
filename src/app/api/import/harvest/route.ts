import { createClient } from "@/lib/supabase/server";
import { validateOrgAccess } from "@/lib/org-context";
import {
  validateHarvestCredentials,
  fetchHarvestClients,
  fetchHarvestProjects,
  fetchHarvestTimeEntries,
} from "@/lib/harvest";
import type { HarvestClient, HarvestProject, HarvestTimeEntry } from "@/lib/harvest";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { token, accountId, organizationId, action } = body as {
    token: string;
    accountId: string;
    organizationId: string;
    action: "validate" | "preview" | "import";
  };

  if (!token || !accountId || !organizationId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Validate org access
  try {
    await validateOrgAccess(organizationId);
  } catch {
    return NextResponse.json(
      { error: "No access to this organization" },
      { status: 403 }
    );
  }

  const opts = { token, accountId };

  // Step 1: Validate credentials
  if (action === "validate") {
    const result = await validateHarvestCredentials(opts);
    return NextResponse.json(result);
  }

  // Step 2: Preview — fetch counts
  if (action === "preview") {
    try {
      const [clients, projects, timeEntries] = await Promise.all([
        fetchHarvestClients(opts),
        fetchHarvestProjects(opts),
        fetchHarvestTimeEntries(opts),
      ]);

      return NextResponse.json({
        clients: clients.length,
        projects: projects.length,
        timeEntries: timeEntries.length,
        clientNames: clients.slice(0, 10).map((c) => c.name),
        projectNames: projects.slice(0, 10).map((p) => p.name),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch data" },
        { status: 500 }
      );
    }
  }

  // Step 3: Import
  if (action === "import") {
    try {
      const [harvestClients, harvestProjects, harvestTimeEntries] =
        await Promise.all([
          fetchHarvestClients(opts),
          fetchHarvestProjects(opts),
          fetchHarvestTimeEntries(opts),
        ]);

      // Track Harvest ID → Stint ID mapping
      const clientMap = new Map<number, string>();
      const projectMap = new Map<number, string>();

      // Import clients
      let clientsImported = 0;
      for (const hc of harvestClients) {
        // Skip inactive clients
        if (!hc.is_active) continue;

        const { data: existing } = await supabase
          .from("clients")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("name", hc.name)
          .limit(1);

        if (existing && existing.length > 0) {
          const first = existing[0];
          if (first) clientMap.set(hc.id, first.id);
          continue;
        }

        const { data: inserted, error } = await supabase
          .from("clients")
          .insert({
            organization_id: organizationId,
            user_id: user.id,
            name: hc.name,
            address: hc.address,
          })
          .select("id")
          .single();

        if (error) {
          console.error(`Failed to import client ${hc.name}:`, error.message);
          continue;
        }

        if (inserted) {
          clientMap.set(hc.id, inserted.id);
          clientsImported++;
        }
      }

      // Import projects
      let projectsImported = 0;
      for (const hp of harvestProjects) {
        if (!hp.is_active) continue;

        const clientId = clientMap.get(hp.client.id) ?? null;

        const { data: existing } = await supabase
          .from("projects")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("name", hp.name)
          .limit(1);

        if (existing && existing.length > 0) {
          const first = existing[0];
          if (first) projectMap.set(hp.id, first.id);
          continue;
        }

        const { data: inserted, error } = await supabase
          .from("projects")
          .insert({
            organization_id: organizationId,
            user_id: user.id,
            client_id: clientId,
            name: hp.name,
            description: hp.notes,
            hourly_rate: hp.hourly_rate,
            budget_hours: hp.budget,
            status: "active",
          })
          .select("id")
          .single();

        if (error) {
          console.error(`Failed to import project ${hp.name}:`, error.message);
          continue;
        }

        if (inserted) {
          projectMap.set(hp.id, inserted.id);
          projectsImported++;
        }
      }

      // Import time entries
      let timeEntriesImported = 0;
      let timeEntriesSkipped = 0;

      // Process in batches to avoid overwhelming the DB
      const BATCH_SIZE = 50;
      for (let i = 0; i < harvestTimeEntries.length; i += BATCH_SIZE) {
        const batch = harvestTimeEntries.slice(i, i + BATCH_SIZE);
        const rows = [];

        for (const hte of batch) {
          const projectId = projectMap.get(hte.project.id);
          if (!projectId) {
            timeEntriesSkipped++;
            continue;
          }

          // Build start/end times from spent_date + started_time/ended_time
          const startTime = hte.started_time
            ? `${hte.spent_date}T${hte.started_time}:00`
            : `${hte.spent_date}T09:00:00`;

          let endTime: string | null = null;
          if (hte.ended_time) {
            endTime = `${hte.spent_date}T${hte.ended_time}:00`;
          } else if (!hte.is_running && hte.hours > 0) {
            // Calculate end time from hours
            const startDate = new Date(startTime);
            const endDate = new Date(
              startDate.getTime() + hte.hours * 60 * 60 * 1000
            );
            endTime = endDate.toISOString();
          }

          rows.push({
            organization_id: organizationId,
            user_id: user.id,
            project_id: projectId,
            description: hte.notes
              ? `${hte.task.name}: ${hte.notes}`
              : hte.task.name,
            start_time: new Date(startTime).toISOString(),
            end_time: endTime ? new Date(endTime).toISOString() : null,
            billable: hte.billable,
          });
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from("time_entries")
            .insert(rows);

          if (error) {
            console.error(`Batch import error:`, error.message);
            timeEntriesSkipped += rows.length;
          } else {
            timeEntriesImported += rows.length;
          }
        }
      }

      return NextResponse.json({
        success: true,
        imported: {
          clients: clientsImported,
          projects: projectsImported,
          timeEntries: timeEntriesImported,
        },
        skipped: {
          timeEntries: timeEntriesSkipped,
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Import failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
