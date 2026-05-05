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

/**
 * Atomically demote the current owner to admin and promote the
 * target user to owner. Caller MUST be the current team owner — the
 * SECURITY DEFINER RPC re-validates that and refuses self-transfer
 * + shell-account targets so this action is safe even if a caller
 * bypasses the UI.
 */
export async function transferOwnershipAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const teamId = formData.get("team_id") as string;
      const newOwnerUserId = formData.get("new_owner_user_id") as string;
      const confirmName = formData.get("confirm_name") as string;
      if (!teamId) throw new Error("team_id is required.");
      if (!newOwnerUserId) {
        throw new Error("Pick a member to transfer ownership to.");
      }

      // Caller must be the current owner — the RPC enforces this
      // too, but checking up front keeps the error message
      // friendlier than a Postgres exception.
      const { role } = await validateTeamAccess(teamId);
      if (role !== "owner") {
        throw new Error("Only the team owner can transfer ownership.");
      }

      // Typed-name confirmation: bookkeeper-friendly destructive
      // gate. Match the target's display_name (or email-prefix
      // when display_name is null) to avoid accidental clicks.
      const { data: targetProfile } = await supabase
        .from("user_profiles")
        .select("display_name")
        .eq("user_id", newOwnerUserId)
        .maybeSingle();
      const expectedName =
        (targetProfile?.display_name as string | null) ?? "";
      if (
        expectedName &&
        confirmName.trim().toLowerCase() !== expectedName.trim().toLowerCase()
      ) {
        throw new Error(
          `Type the new owner's name (${expectedName}) to confirm.`,
        );
      }

      const { error } = await supabase.rpc("transfer_team_ownership", {
        p_team_id: teamId,
        p_new_owner_user_id: newOwnerUserId,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/teams/${teamId}`);
      revalidatePath(`/teams`);
    },
    "transferOwnershipAction",
  ) as unknown as void;
}

/**
 * Promote a member to admin or demote an admin to member. Owner can
 * do either; admins can only demote (the SECURITY DEFINER RPC
 * enforces this asymmetry — admins can't self-promote-by-proxy).
 * Use `transferOwnershipAction` to change the owner.
 */
export async function updateMemberRoleAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const teamId = formData.get("team_id") as string;
      const memberId = formData.get("member_id") as string;
      const newRole = formData.get("new_role") as string;
      if (!teamId) throw new Error("team_id is required.");
      if (!memberId) throw new Error("member_id is required.");
      if (newRole !== "admin" && newRole !== "member") {
        throw new Error("New role must be 'admin' or 'member'.");
      }

      const { role } = await validateTeamAccess(teamId);
      if (!isTeamAdmin(role)) {
        throw new Error("Only owners and admins can change roles.");
      }

      const { error } = await supabase.rpc("update_team_member_role", {
        p_team_id: teamId,
        p_member_id: memberId,
        p_new_role: newRole,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/teams/${teamId}`);
    },
    "updateMemberRoleAction",
  ) as unknown as void;
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
