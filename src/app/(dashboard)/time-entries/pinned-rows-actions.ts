"use server";

import { revalidatePath } from "next/cache";
import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess, requireTeamAdmin } from "@/lib/team-context";

/**
 * Server actions for persistent timesheet rows (persona-converged
 * 2026-05-13). Two primitives:
 *
 *   - Per-user pins (time_pinned_rows) — every team member can pin
 *     their own (project, category) rows for themselves.
 *   - Team defaults (time_team_default_rows) — owners / admins
 *     create rows that every member of the team sees by default.
 *
 * RLS enforces the gates at the DB layer too; these actions surface
 * a clearer error to the user and revalidate the time-entries page
 * after the write.
 */

/** Pin a (project, category) row for the current user. category_id
 *  can be null = "any category for this project." Idempotent via the
 *  partial unique indexes — re-pinning is a no-op. */
export async function pinRowAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const teamId = (fd.get("team_id") as string) || "";
      const projectId = (fd.get("project_id") as string) || "";
      const categoryIdRaw = fd.get("category_id");
      const categoryId =
        typeof categoryIdRaw === "string" && categoryIdRaw.length > 0
          ? categoryIdRaw
          : null;
      if (!teamId) throw new Error("team_id is required.");
      if (!projectId) throw new Error("project_id is required.");
      // Defense in depth — RLS would also block, but a clean error
      // message helps when the form misroutes.
      await validateTeamAccess(teamId);
      // Upsert via insert with on-conflict-do-nothing semantics by
      // catching the unique-violation code (23505). The partial
      // indexes already guarantee at most one row per
      // (team, user, project, category) tuple.
      const { error } = await supabase.from("time_pinned_rows").insert({
        team_id: teamId,
        user_id: userId,
        project_id: projectId,
        category_id: categoryId,
      });
      if (error && error.code !== "23505") {
        throw error;
      }
      revalidatePath("/time-entries");
    },
    "pinRowAction",
  ) as unknown as void;
}

/** Unpin a (project, category) row for the current user. Idempotent —
 *  unpinning an already-unpinned row is a no-op. */
export async function unpinRowAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const teamId = (fd.get("team_id") as string) || "";
      const projectId = (fd.get("project_id") as string) || "";
      const categoryIdRaw = fd.get("category_id");
      const categoryId =
        typeof categoryIdRaw === "string" && categoryIdRaw.length > 0
          ? categoryIdRaw
          : null;
      if (!teamId) throw new Error("team_id is required.");
      if (!projectId) throw new Error("project_id is required.");
      await validateTeamAccess(teamId);
      let q = supabase
        .from("time_pinned_rows")
        .delete()
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .eq("project_id", projectId);
      // `eq` with null doesn't work in PostgREST; use `.is` instead.
      if (categoryId === null) q = q.is("category_id", null);
      else q = q.eq("category_id", categoryId);
      assertSupabaseOk(await q);
      revalidatePath("/time-entries");
    },
    "unpinRowAction",
  ) as unknown as void;
}

/** Set a team-default row. Owner / admin only — RLS enforces the
 *  same; this surfaces a friendly error. Idempotent. */
export async function setTeamDefaultRowAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const teamId = (fd.get("team_id") as string) || "";
      const projectId = (fd.get("project_id") as string) || "";
      const categoryIdRaw = fd.get("category_id");
      const categoryId =
        typeof categoryIdRaw === "string" && categoryIdRaw.length > 0
          ? categoryIdRaw
          : null;
      if (!teamId) throw new Error("team_id is required.");
      if (!projectId) throw new Error("project_id is required.");
      await requireTeamAdmin(teamId);
      // Validate the project belongs to the team — defensive guard
      // against a stale form value or cross-team injection.
      const { data: project } = await supabase
        .from("projects")
        .select("id, team_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.team_id !== teamId) {
        throw new Error("Project not found on this team.");
      }
      const { error } = await supabase
        .from("time_team_default_rows")
        .insert({
          team_id: teamId,
          project_id: projectId,
          category_id: categoryId,
          created_by_user_id: userId,
        });
      if (error && error.code !== "23505") {
        throw error;
      }
      revalidatePath("/time-entries");
    },
    "setTeamDefaultRowAction",
  ) as unknown as void;
}

/** Remove a team-default row. Owner / admin only. Idempotent. */
export async function unsetTeamDefaultRowAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = (fd.get("team_id") as string) || "";
      const projectId = (fd.get("project_id") as string) || "";
      const categoryIdRaw = fd.get("category_id");
      const categoryId =
        typeof categoryIdRaw === "string" && categoryIdRaw.length > 0
          ? categoryIdRaw
          : null;
      if (!teamId) throw new Error("team_id is required.");
      if (!projectId) throw new Error("project_id is required.");
      await requireTeamAdmin(teamId);
      let q = supabase
        .from("time_team_default_rows")
        .delete()
        .eq("team_id", teamId)
        .eq("project_id", projectId);
      if (categoryId === null) q = q.is("category_id", null);
      else q = q.eq("category_id", categoryId);
      assertSupabaseOk(await q);
      revalidatePath("/time-entries");
    },
    "unsetTeamDefaultRowAction",
  ) as unknown as void;
}
