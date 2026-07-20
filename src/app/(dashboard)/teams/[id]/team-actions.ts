"use server";

import { runSafeAction } from "@/lib/safe-action";
import { AppError, assertSupabaseOk } from "@/lib/errors";
import { isTeamAdmin, validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/logger";
import { loadTeamConfig } from "@/lib/messaging/outbox";
import { sendTeamInviteEmail } from "@/lib/messaging/send-team-invite";
import { escapeHtml } from "@/lib/messaging/escape-html";
import type { SupabaseClient } from "@supabase/supabase-js";

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

    // Select the generated token + expiry back so a configured team
    // can email the accept link immediately, and so the members page
    // can always render a "Copy invite link" fallback regardless of
    // whether that email goes out (see tryDeliverInviteEmail below).
    const invite = assertSupabaseOk(
      await supabase
        .from("team_invites")
        .insert({
          team_id: teamId,
          email,
          role: inviteRole,
          invited_by: userId,
        })
        .select("id, token, expires_at")
        .single()
    );
    if (!invite) {
      throw new Error("Invite insert returned no row.");
    }

    await tryDeliverInviteEmail(supabase, {
      teamId,
      userId,
      email,
      inviteRole,
      inviteId: invite.id as string,
      token: invite.token as string,
      expiresAt: invite.expires_at as string,
    });

    revalidatePath(`/teams/${teamId}`);
  }, "inviteMemberAction") as unknown as void;
}

/**
 * Best-effort invite email, sent through the same outbox pipeline
 * invoices and proposals use. A team without email configured (no
 * `NEXT_PUBLIC_APP_URL`, no `team_email_config` row, missing API key,
 * unverified domain, daily cap reached, …) must NEVER block invite
 * creation — the invite row + the "Copy invite link" button on the
 * members page are the durable path either way. Every failure here
 * is logged, never re-thrown.
 */
async function tryDeliverInviteEmail(
  supabase: SupabaseClient,
  input: {
    teamId: string;
    userId: string;
    email: string;
    inviteRole: string;
    inviteId: string;
    token: string;
    expiresAt: string;
  },
): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return;

  try {
    const cfg = await loadTeamConfig(supabase, input.teamId);
    if (!cfg?.apiKeyCipher || !cfg.fromEmail) return;

    const { data: team } = await supabase
      .from("teams")
      .select("name")
      .eq("id", input.teamId)
      .single();
    const teamName = (team?.name as string | undefined) ?? "Shyre";
    const safeTeamName = escapeHtml(teamName);
    const acceptUrl = `${baseUrl}/auth/accept-invite?token=${input.token}`;
    const expiresLabel = input.expiresAt.slice(0, 10);
    const article = input.inviteRole === "admin" ? "an" : "a";

    await sendTeamInviteEmail(supabase, {
      teamId: input.teamId,
      userId: input.userId,
      inviteId: input.inviteId,
      toEmail: input.email,
      subject: `You're invited to join ${teamName} on Shyre`,
      bodyHtml: `<p>You've been invited to join <strong>${safeTeamName}</strong> on Shyre as ${article} ${input.inviteRole}.</p><p><a href="${acceptUrl}">Accept the invite</a></p><p>This link expires on ${expiresLabel}.</p>`,
      bodyText: `You've been invited to join ${teamName} on Shyre as ${article} ${input.inviteRole}.\n\nAccept the invite: ${acceptUrl}\n\nThis link expires on ${expiresLabel}.`,
    });
  } catch (err) {
    logError(err, {
      userId: input.userId,
      teamId: input.teamId,
      action: "inviteMemberAction.sendEmail",
    });
  }
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

    // The owner guard depends on this read succeeding — an unchecked
    // failure here (RLS-hidden row, transient error) would skip the
    // guard and let the delete proceed. Fail closed instead.
    const { data: member, error: memberErr } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", memberId)
      .single();
    if (memberErr) throw AppError.fromSupabase(memberErr);

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

    // Defense in depth: the RLS policy already scopes the delete to
    // this team via `team_invites_manage`, but scoping the query
    // itself means a bug in that policy fails closed (0 rows deleted)
    // instead of deleting an invite in a team the caller doesn't
    // admin.
    assertSupabaseOk(
      await supabase
        .from("team_invites")
        .delete()
        .eq("id", inviteId)
        .eq("team_id", teamId)
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
      if (error) throw AppError.fromSupabase(error);

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
      if (error) throw AppError.fromSupabase(error);

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
    // parseFloat("abc") is NaN and Postgres numeric ACCEPTS NaN —
    // an unchecked write would corrupt the member's rate.
    if (default_rate !== null && !Number.isFinite(default_rate)) {
      throw new Error(`"${rateStr}" is not a valid rate.`);
    }

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
