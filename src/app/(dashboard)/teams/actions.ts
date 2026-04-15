"use server";

import { runSafeAction } from "@/lib/safe-action";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createTeamAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const name = formData.get("team_name") as string;
    if (!name || name.trim().length === 0) {
      throw new Error("Team name is required.");
    }

    // Atomic creation via SECURITY DEFINER function — handles RLS correctly
    const { error } = await supabase.rpc("create_team", {
      team_name: name.trim(),
    });

    if (error) throw new Error(error.message);

    revalidatePath("/");
    redirect("/teams");
  }, "createTeamAction") as unknown as void;
}

export async function leaveTeamAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { userId, role } = await validateTeamAccess(teamId);

    // Cannot leave if sole owner
    if (role === "owner") {
      const { data: owners } = await supabase
        .from("team_members")
        .select("id")
        .eq("team_id", teamId)
        .eq("role", "owner");

      if (!owners || owners.length <= 1) {
        throw new Error("Transfer ownership before leaving. You are the sole owner.");
      }
    }

    const { error: leaveError, count } = await supabase
      .from("team_members")
      .delete({ count: "exact" })
      .eq("team_id", teamId)
      .eq("user_id", userId);

    if (leaveError) throw new Error(leaveError.message);
    if (count === 0) {
      throw new Error("Leave failed — membership was not removed.");
    }

    revalidatePath("/teams");
    redirect("/teams");
  }, "leaveTeamAction") as unknown as void;
}

export async function deleteTeamAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const confirmName = formData.get("confirm_name") as string;
    const { role } = await validateTeamAccess(teamId);

    if (role !== "owner") {
      throw new Error("Only the owner can delete an team.");
    }

    // Verify org name matches
    const { data: org } = await supabase
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .single();

    if (!org || confirmName !== org.name) {
      throw new Error("Team name does not match. Deletion cancelled.");
    }

    // Delete and verify it actually happened (RLS may silently return 0 rows)
    const { error: deleteError, count } = await supabase
      .from("teams")
      .delete({ count: "exact" })
      .eq("id", teamId);

    if (deleteError) throw new Error(deleteError.message);
    if (count === 0) {
      throw new Error(
        "Delete failed — the team was not removed. You may not have permission to delete it."
      );
    }

    revalidatePath("/teams");
    redirect("/teams");
  }, "deleteTeamAction") as unknown as void;
}
