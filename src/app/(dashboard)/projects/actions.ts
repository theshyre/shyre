"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

export async function createProjectAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { userId } = await validateTeamAccess(teamId);

    const name = formData.get("name") as string;
    const customer_id = (formData.get("customer_id") as string) || null;
    const description = (formData.get("description") as string) || null;
    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = (formData.get("github_repo") as string) || null;
    const category_set_id = (formData.get("category_set_id") as string) || null;
    const require_timestamps = formData.get("require_timestamps") === "on";

    assertSupabaseOk(
      await supabase.from("projects").insert({
        team_id: teamId,
        user_id: userId,
        customer_id,
        name,
        description,
        hourly_rate,
        budget_hours,
        github_repo,
        category_set_id,
        require_timestamps,
      })
    );

    revalidatePath("/projects");
    if (customer_id) revalidatePath(`/customers/${customer_id}`);
  }, "createProjectAction") as unknown as void;
}

export async function updateProjectAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = (formData.get("github_repo") as string) || null;
    const status = formData.get("status") as string;
    const category_set_id = (formData.get("category_set_id") as string) || null;
    const require_timestamps = formData.get("require_timestamps") === "on";

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({
          name,
          description,
          hourly_rate,
          budget_hours,
          github_repo,
          status,
          category_set_id,
          require_timestamps,
        })
        .eq("id", id)
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  }, "updateProjectAction") as unknown as void;
}

interface ProjectCategoryInput {
  /** Existing category id — present when editing an already-saved category. */
  id?: string;
  name: string;
  color: string;
  sort_order: number;
}

/**
 * Upsert a project-scoped category set. Creates the set (bound to the
 * project via category_sets.project_id, team_id NULL) if it doesn't
 * exist, then syncs the categories list: inserts new ones, updates
 * edited ones, deletes ones the user removed.
 *
 * Form contract:
 *   project_id — required
 *   set_name — name of the set (defaults to "Project categories")
 *   categories — JSON array of { id?, name, color, sort_order }
 *
 * On first create, also links `projects.category_set_id` to the new set.
 */
export async function upsertProjectCategoriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const project_id = formData.get("project_id") as string;
    if (!project_id) throw new Error("project_id is required");
    const setName =
      (formData.get("set_name") as string) || "Project categories";
    const categoriesRaw = formData.get("categories") as string;
    const categories: ProjectCategoryInput[] = categoriesRaw
      ? (JSON.parse(categoriesRaw) as ProjectCategoryInput[])
      : [];

    // Resolve the project's team (membership check) — derive server-side
    // so a stale form can't target a project the user can't edit.
    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id, category_set_id")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");
    await validateTeamAccess(project.team_id as string);

    // Find or create the project-scoped set. It's identified by
    // project_id (one project-scoped set per project — if the project
    // already has a team/system set, creating a project-scoped one
    // replaces that pointer).
    const { data: existingSet } = await supabase
      .from("category_sets")
      .select("id")
      .eq("project_id", project_id)
      .maybeSingle();
    let setId = existingSet?.id as string | undefined;
    if (!setId) {
      const insert = await supabase
        .from("category_sets")
        .insert({
          project_id,
          team_id: null,
          is_system: false,
          name: setName,
          created_by: userId,
        })
        .select("id")
        .single();
      assertSupabaseOk(insert);
      setId = insert.data?.id as string;
    } else if (setName) {
      // Rename on subsequent calls so the set label stays in sync.
      assertSupabaseOk(
        await supabase
          .from("category_sets")
          .update({ name: setName })
          .eq("id", setId),
      );
    }

    // Sync categories: delete rows whose id is no longer in the payload,
    // update rows with matching id, insert rows without id.
    const { data: currentRows } = await supabase
      .from("categories")
      .select("id")
      .eq("category_set_id", setId);
    const keptIds = categories
      .map((c) => c.id)
      .filter((x): x is string => typeof x === "string");
    const toDelete = (currentRows ?? [])
      .map((r) => r.id as string)
      .filter((id) => !keptIds.includes(id));
    if (toDelete.length > 0) {
      assertSupabaseOk(
        await supabase.from("categories").delete().in("id", toDelete),
      );
    }

    for (const cat of categories) {
      if (cat.id) {
        assertSupabaseOk(
          await supabase
            .from("categories")
            .update({
              name: cat.name,
              color: cat.color,
              sort_order: cat.sort_order,
            })
            .eq("id", cat.id),
        );
      } else {
        assertSupabaseOk(
          await supabase.from("categories").insert({
            category_set_id: setId,
            name: cat.name,
            color: cat.color,
            sort_order: cat.sort_order,
          }),
        );
      }
    }

    // Link the project to this set if it wasn't already pointed at it.
    if (project.category_set_id !== setId) {
      assertSupabaseOk(
        await supabase
          .from("projects")
          .update({ category_set_id: setId })
          .eq("id", project_id),
      );
    }

    revalidatePath(`/projects/${project_id}`);
    revalidatePath("/time-entries");
  }, "upsertProjectCategoriesAction") as unknown as void;
}

/**
 * Remove the project's project-scoped category set entirely. Drops the
 * set (categories cascade via FK) and nulls projects.category_set_id.
 * Doesn't touch the project's time entries — their `category_id`s were
 * set to NULL by the ON DELETE SET NULL on time_entries.category_id.
 */
export async function deleteProjectCategoriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const project_id = formData.get("project_id") as string;
    if (!project_id) throw new Error("project_id is required");

    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");
    await validateTeamAccess(project.team_id as string);

    const { data: set } = await supabase
      .from("category_sets")
      .select("id")
      .eq("project_id", project_id)
      .maybeSingle();

    if (set?.id) {
      // ON DELETE CASCADE drops categories under the set.
      assertSupabaseOk(
        await supabase.from("category_sets").delete().eq("id", set.id),
      );
    }
    // Null the project's link (even if the set wasn't there — idempotent).
    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ category_set_id: null })
        .eq("id", project_id),
    );

    revalidatePath(`/projects/${project_id}`);
    revalidatePath("/time-entries");
  }, "deleteProjectCategoriesAction") as unknown as void;
}
