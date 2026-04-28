"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

/** Atlassian project keys are uppercase 2+ chars, letters/digits.
 *  Normalize for symmetry with the detection regex in
 *  src/lib/tickets/detect.ts so a user typing "proj" still resolves
 *  short refs against "PROJ-123" later. Empty / whitespace → null. */
function normalizeJiraKey(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z][A-Z0-9_]+$/.test(s)) {
    throw new Error(
      "Jira project key must be uppercase letters / digits, 2+ chars (e.g. PROJ).",
    );
  }
  return s;
}

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
    const jira_project_key = normalizeJiraKey(formData.get("jira_project_key"));
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
        jira_project_key,
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
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = (formData.get("github_repo") as string) || null;
    const jira_project_key = normalizeJiraKey(formData.get("jira_project_key"));
    const status = formData.get("status") as string;
    const category_set_id = (formData.get("category_set_id") as string) || null;
    const require_timestamps = formData.get("require_timestamps") === "on";

    const patch: Record<string, unknown> = {
      name,
      description,
      budget_hours,
      github_repo,
      jira_project_key,
      status,
      category_set_id,
      require_timestamps,
    };

    // Guardrail: only include hourly_rate in the UPDATE if the caller is
    // authorized by rate_editability. Existing form submissions and
    // forged direct POSTs that include hourly_rate for an unauthorized
    // caller get silently dropped — the rest of the update applies so
    // a non-rate edit still succeeds. The dedicated setProjectRateAction
    // below is the right path for rate-only updates.
    if (formData.has("hourly_rate")) {
      const { data: canSet } = await supabase.rpc("can_set_project_rate", {
        p_project_id: id,
      });
      if (canSet) {
        const rateStr = formData.get("hourly_rate") as string;
        patch.hourly_rate = rateStr ? parseFloat(rateStr) : null;
      }
    }

    assertSupabaseOk(
      await supabase.from("projects").update(patch).eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  }, "updateProjectAction") as unknown as void;
}

export async function setProjectRateAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: canSet } = await supabase.rpc("can_set_project_rate", {
      p_project_id: id,
    });
    if (!canSet) {
      throw new Error("Not authorized to set this project's rate.");
    }

    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;

    assertSupabaseOk(
      await supabase.from("projects").update({ hourly_rate }).eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  }, "setProjectRateAction") as unknown as void;
}

const PROJECT_TIME_ENTRIES_VISIBILITY = new Set([
  "own_only",
  "read_all",
  "read_write_all",
]);

/**
 * Set the per-project time_entries_visibility override. Pass `null`
 * (or omit the level field) to clear and fall back to the team value.
 * Owner/admin only.
 */
export async function setProjectTimeEntriesVisibilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: project } = await supabase
      .from("projects")
      .select("team_id")
      .eq("id", id)
      .single();
    const teamId = (project as { team_id?: string } | null)?.team_id;
    if (!teamId) throw new Error("Project not found.");

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error(
        "Only owners and admins can change project time-entry visibility.",
      );
    }

    const rawLevel = formData.get("level");
    let level: string | null;
    if (rawLevel === null || rawLevel === "") {
      level = null; // inherit team
    } else {
      level = rawLevel as string;
      if (!PROJECT_TIME_ENTRIES_VISIBILITY.has(level)) {
        throw new Error(
          `Invalid level "${level}". Allowed: own_only, read_all, read_write_all, or empty to inherit.`,
        );
      }
    }

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ time_entries_visibility: level })
        .eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath(`/teams/${teamId}`);
  }, "setProjectTimeEntriesVisibilityAction") as unknown as void;
}

interface ProjectCategoryInput {
  /** Existing category id — present when editing an already-saved category. */
  id?: string;
  name: string;
  color: string;
  sort_order: number;
}

/**
 * Upsert the project's full category configuration in one call:
 *   - base_category_set_id: pointer to a system or team set (nullable)
 *   - project-scoped extension set + its categories (additive)
 *
 * Form contract:
 *   project_id — required
 *   base_category_set_id — optional; if present (including empty string
 *     to mean "none") updates projects.category_set_id
 *   set_name — name of the extension set (defaults to "Project categories")
 *   categories — JSON array of { id?, name, color, sort_order } for the
 *     extension set. Empty array clears the extension (extension set is
 *     preserved for re-use but has no categories).
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
    // base_category_set_id is optional — only set when the caller is
    // also changing the base. Empty string means "no base set".
    const baseSetRaw = formData.get("base_category_set_id");
    const baseSetUpdateRequested = baseSetRaw !== null;
    const baseSetId =
      typeof baseSetRaw === "string" && baseSetRaw.length > 0
        ? baseSetRaw
        : null;

    // Resolve the project's team (membership check) — derive server-side
    // so a stale form can't target a project the user can't edit.
    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id, category_set_id")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");
    await validateTeamAccess(project.team_id as string);

    // Update the base pointer first so the picker's read-side stays
    // consistent if the extension upsert is expensive.
    if (
      baseSetUpdateRequested &&
      project.category_set_id !== baseSetId
    ) {
      assertSupabaseOk(
        await supabase
          .from("projects")
          .update({ category_set_id: baseSetId })
          .eq("id", project_id),
      );
    }

    // Cross-set overlap check: extension names must not collide (case-
    // insensitive) with categories in the base set. Two "Admin" items
    // in the picker would be confusing and unresolvable.
    const effectiveBaseId = baseSetUpdateRequested
      ? baseSetId
      : (project.category_set_id as string | null);
    if (effectiveBaseId && categories.length > 0) {
      const { data: baseCats } = await supabase
        .from("categories")
        .select("name")
        .eq("category_set_id", effectiveBaseId);
      const baseNames = new Set(
        (baseCats ?? []).map((c) => (c.name as string).toLowerCase()),
      );
      const overlapping = categories.filter((c) =>
        baseNames.has(c.name.trim().toLowerCase()),
      );
      if (overlapping.length > 0) {
        const names = overlapping.map((c) => c.name).join(", ");
        throw new Error(
          `These names already exist in the base set: ${names}. Rename or remove them to avoid duplicates in the picker.`,
        );
      }
    }

    // Find or create the project-scoped set. It's identified by
    // project_id (one project-scoped set per project).
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

    // Intentionally DO NOT repoint `projects.category_set_id`. The project
    // keeps whatever base set (system or team) it's using; the project-
    // scoped set here is an *extension* discovered via
    // `category_sets.project_id = project.id`. Time-entry pickers union
    // the two at read time.

    revalidatePath(`/projects/${project_id}`);
    revalidatePath("/time-entries");
  }, "upsertProjectCategoriesAction") as unknown as void;
}

/**
 * Remove the project's project-scoped extension category set. Drops the
 * set (categories cascade via FK). The project's base `category_set_id`
 * is intentionally left alone — the user keeps whatever system / team
 * set they had. Time entries that referenced extension categories get
 * their `category_id` nulled automatically via ON DELETE SET NULL on
 * time_entries.category_id.
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

    revalidatePath(`/projects/${project_id}`);
    revalidatePath("/time-entries");
  }, "deleteProjectCategoriesAction") as unknown as void;
}
