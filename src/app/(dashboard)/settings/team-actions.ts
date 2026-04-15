"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

export async function inviteMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("org_id") as string;
    const { userId, role } = await validateTeamAccess(teamId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can invite members.");
    }

    const email = formData.get("email") as string;
    const inviteRole = (formData.get("role") as string) || "member";

    if (inviteRole !== "admin" && inviteRole !== "member") {
      throw new Error("Invalid role. Must be admin or member.");
    }

    assertSupabaseOk(
      await supabase.from("team_invites").insert({
        team_id: teamId,
        email,
        role: inviteRole,
        invited_by: userId,
      })
    );

    revalidatePath(`/teams/${teamId}`);
  }, "inviteMemberAction") as unknown as void;
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("org_id") as string;
    const { userId, role } = await validateTeamAccess(teamId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can remove members.");
    }

    const memberId = formData.get("member_id") as string;
    const memberUserId = formData.get("member_user_id") as string;

    if (memberUserId === userId) {
      throw new Error("You cannot remove yourself.");
    }

    const { data: member } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", memberId)
      .single();

    if (member?.role === "owner") {
      throw new Error("Cannot remove the team owner.");
    }

    assertSupabaseOk(
      await supabase
        .from("team_members")
        .delete()
        .eq("id", memberId)
    );

    revalidatePath(`/teams/${teamId}`);
  }, "removeMemberAction") as unknown as void;
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("org_id") as string;
    const { role } = await validateTeamAccess(teamId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can revoke invites.");
    }

    const inviteId = formData.get("invite_id") as string;

    assertSupabaseOk(
      await supabase
        .from("team_invites")
        .delete()
        .eq("id", inviteId)
    );

    revalidatePath(`/teams/${teamId}`);
  }, "revokeInviteAction") as unknown as void;
}

export async function updateTeamNameAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("org_id") as string;
    const { role } = await validateTeamAccess(teamId);

    if (role !== "owner") {
      throw new Error("Only the owner can rename the team.");
    }

    const name = formData.get("team_name") as string;

    assertSupabaseOk(
      await supabase
        .from("teams")
        .update({ name })
        .eq("id", teamId)
    );

    revalidatePath(`/teams/${teamId}`);
  }, "updateTeamNameAction") as unknown as void;
}
