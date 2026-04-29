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
    const { userId, role } = await validateTeamAccess(teamId);

    if (role !== "owner") {
      throw new Error("Only the owner can delete a team.");
    }

    // Refuse to orphan the actor: if this is their only team,
    // deleting it leaves them with no team_members row at all,
    // which breaks every page that calls validateTeamAccess. Force
    // them to create another team first. Personal teams (created
    // automatically on signup) count toward this check, so the
    // user always has somewhere to land.
    const { count: ownedTeamsCount } = await supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((ownedTeamsCount ?? 0) <= 1) {
      throw new Error(
        "You can't delete your last team. Create another team first.",
      );
    }

    // Snapshot business_id BEFORE deleting — `teams.business_id` is
    // ON DELETE RESTRICT going up to businesses, but the team-side
    // FK is RESTRICT only; reading the column after the team row
    // is gone returns nothing. We need it to detect "did the
    // business become orphaned by this delete?" below.
    const { data: org } = await supabase
      .from("teams")
      .select("name, business_id")
      .eq("id", teamId)
      .single();

    if (!org || confirmName !== org.name) {
      throw new Error("Team name does not match. Deletion cancelled.");
    }
    const businessId = (org.business_id as string | null) ?? null;

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

    // Orphan-business cleanup: if the team we just deleted was the
    // last team under its business, the business is unreachable
    // (only a team-membership grants RLS visibility into a
    // business). Mirror the cleanup pattern from
    // cleanupOrphanTeamsAction so the user doesn't end up with a
    // ghost business in their sidebar.
    if (businessId) {
      const { count: remainingTeams } = await supabase
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if ((remainingTeams ?? 0) === 0) {
        await supabase.from("businesses").delete().eq("id", businessId);
      }
    }

    revalidatePath("/teams");
    revalidatePath("/business");
    redirect("/teams");
  }, "deleteTeamAction") as unknown as void;
}
