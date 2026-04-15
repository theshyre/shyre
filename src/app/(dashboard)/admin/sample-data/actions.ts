"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { isSystemAdmin } from "@/lib/system-admin";
import { revalidatePath } from "next/cache";
import { generateSampleData } from "@/lib/sample-data/generate";

async function requireAdminOfTeam(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  teamId: string,
): Promise<{ userId: string; teamName: string }> {
  if (!(await isSystemAdmin())) {
    throw new Error("System admin access required.");
  }
  const { userId, role } = await validateTeamAccess(teamId);
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners or admins of the target org can run this tool.");
  }
  const { data: teamRow } = await supabase
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .single();
  if (!teamRow) throw new Error("Team not found.");
  return { userId, teamName: teamRow.name as string };
}

function asTeamId(formData: FormData): string {
  const v = formData.get("team_id");
  if (typeof v !== "string" || v.length === 0) {
    throw new Error("team_id is required.");
  }
  return v;
}

/**
 * Delete sample rows in one org, in child-to-parent order so cascades behave.
 */
async function deleteSampleRowsInOrg(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  teamId: string,
): Promise<void> {
  assertSupabaseOk(
    await supabase
      .from("expenses")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("time_entries")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("projects")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("customers")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
}

/**
 * Load (or replay) sample data into the target org. Wipes prior sample rows
 * in the org first so repeat invocations produce a fresh spread without
 * accumulating duplicates.
 */
export async function loadSampleDataAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const teamId = asTeamId(fd);
      await requireAdminOfTeam(supabase, teamId);

      // Wipe existing sample rows so this is idempotent.
      await deleteSampleRowsInOrg(supabase, teamId);

      const data = generateSampleData({ now: new Date() });

      // 1. Customers
      const customerInserts = data.customers.map((c) => ({
        user_id: userId,
        team_id: teamId,
        name: c.name,
        email: c.email,
        default_rate: c.default_rate,
        notes: c.notes,
        is_sample: true,
      }));
      const custRes = await supabase
        .from("customers")
        .insert(customerInserts)
        .select("id");
      assertSupabaseOk(custRes);
      const customerIds = (custRes.data ?? []).map((r) => r.id as string);
      if (customerIds.length !== data.customers.length) {
        throw new Error("Failed to insert all sample customers.");
      }

      // 2. Projects
      const projectInserts = data.projects.map((p) => ({
        user_id: userId,
        team_id: teamId,
        customer_id: p.customerIndex === null ? null : customerIds[p.customerIndex],
        name: p.name,
        description: p.description,
        hourly_rate: p.hourly_rate,
        github_repo: p.github_repo,
        status: p.status,
        is_sample: true,
      }));
      const projRes = await supabase
        .from("projects")
        .insert(projectInserts)
        .select("id");
      assertSupabaseOk(projRes);
      const projectIds = (projRes.data ?? []).map((r) => r.id as string);
      if (projectIds.length !== data.projects.length) {
        throw new Error("Failed to insert all sample projects.");
      }

      // 3. Time entries — chunked to stay under reasonable payload sizes.
      const entryInserts = data.entries.map((e) => ({
        user_id: userId,
        team_id: teamId,
        project_id: projectIds[e.projectIndex]!,
        description: e.description,
        start_time: e.startIso,
        end_time: e.endIso,
        billable: e.billable,
        github_issue: e.github_issue,
        is_sample: true,
      }));
      const CHUNK = 200;
      for (let i = 0; i < entryInserts.length; i += CHUNK) {
        assertSupabaseOk(
          await supabase.from("time_entries").insert(entryInserts.slice(i, i + CHUNK)),
        );
      }

      // 4. Expenses
      const expenseInserts = data.expenses.map((e) => ({
        user_id: userId,
        team_id: teamId,
        project_id: e.projectIndex === null ? null : projectIds[e.projectIndex]!,
        incurred_on: e.incurredOn,
        amount: e.amount,
        currency: e.currency,
        vendor: e.vendor,
        category: e.category,
        description: e.description,
        billable: e.billable,
        is_sample: true,
      }));
      for (let i = 0; i < expenseInserts.length; i += CHUNK) {
        assertSupabaseOk(
          await supabase.from("expenses").insert(expenseInserts.slice(i, i + CHUNK)),
        );
      }

      revalidatePath("/admin/sample-data");
      revalidatePath("/time-entries");
      revalidatePath("/customers");
      revalidatePath("/projects");
      revalidatePath("/business");
    },
    "loadSampleDataAction",
  );
}

/**
 * Delete all sample-flagged rows in the target org. Real data is untouched.
 */
export async function removeSampleDataAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = asTeamId(fd);
      await requireAdminOfTeam(supabase, teamId);
      await deleteSampleRowsInOrg(supabase, teamId);
      revalidatePath("/admin/sample-data");
      revalidatePath("/time-entries");
      revalidatePath("/customers");
      revalidatePath("/projects");
      revalidatePath("/business");
    },
    "removeSampleDataAction",
  );
}

/**
 * Destructive: wipe EVERY customer / project / time_entry in the target org,
 * regardless of is_sample. Requires the user to type the org name as
 * confirmation.
 */
export async function clearAllTeamDataAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = asTeamId(fd);
      const confirmName = String(fd.get("confirm_name") ?? "");
      const { teamName } = await requireAdminOfTeam(supabase, teamId);
      if (confirmName !== teamName) {
        throw new Error(
          `Typed confirmation did not match the team name "${teamName}".`,
        );
      }

      assertSupabaseOk(
        await supabase.from("expenses").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("time_entries").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("projects").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("customers").delete().eq("team_id", teamId),
      );

      revalidatePath("/admin/sample-data");
      revalidatePath("/time-entries");
      revalidatePath("/customers");
      revalidatePath("/projects");
      revalidatePath("/business");
    },
    "clearAllTeamDataAction",
  );
}
