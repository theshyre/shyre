"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { isTeamAdmin, validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

export async function inviteMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { userId, role } = await validateTeamAccess(teamId);

    if (!isTeamAdmin(role)) {
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
    const teamId = formData.get("team_id") as string;
    const { userId, role } = await validateTeamAccess(teamId);

    if (!isTeamAdmin(role)) {
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
    const teamId = formData.get("team_id") as string;
    const { role } = await validateTeamAccess(teamId);

    if (!isTeamAdmin(role)) {
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
    const teamId = formData.get("team_id") as string;
    const { role } = await validateTeamAccess(teamId);

    // Admins can rename — matches the rest of the team-config write
    // surface (invite, remove, revoke, settings, email, templates).
    // Owner-only would be an asymmetry with no documented rationale,
    // and a delegated team admin should be able to rebrand the team
    // without escalating to the owner. Owner-only operations remain:
    // ownership transfer + team deletion.
    if (!isTeamAdmin(role)) {
      throw new Error("Only the team owner or admin can rename the team.");
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

export async function setMemberRateAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const membershipId = formData.get("membership_id") as string;
    if (!membershipId) throw new Error("membership_id is required.");

    const { data: canSet } = await supabase.rpc("can_set_member_rate", {
      p_membership_id: membershipId,
    });
    if (!canSet) {
      throw new Error("Not authorized to set this member's rate.");
    }

    const rateStr = formData.get("default_rate") as string;
    const default_rate = rateStr ? parseFloat(rateStr) : null;

    // Look up team_id so the revalidation targets the right page. The
    // caller has already passed the can_set_member_rate check, so
    // reading the base row for team_id is safe.
    const { data: membership } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("id", membershipId)
      .single();

    assertSupabaseOk(
      await supabase
        .from("team_members")
        .update({ default_rate })
        .eq("id", membershipId),
    );

    if (membership?.team_id) {
      revalidatePath(`/teams/${membership.team_id}`);
    }
  }, "setMemberRateAction") as unknown as void;
}
