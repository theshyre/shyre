"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function inviteMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("org_id") as string;
    const { userId, role } = await validateOrgAccess(orgId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can invite members.");
    }

    const email = formData.get("email") as string;
    const inviteRole = (formData.get("role") as string) || "member";

    if (inviteRole !== "admin" && inviteRole !== "member") {
      throw new Error("Invalid role. Must be admin or member.");
    }

    assertSupabaseOk(
      await supabase.from("organization_invites").insert({
        organization_id: orgId,
        email,
        role: inviteRole,
        invited_by: userId,
      })
    );

    revalidatePath("/settings");
  }, "inviteMemberAction") as unknown as void;
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("org_id") as string;
    const { userId, role } = await validateOrgAccess(orgId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can remove members.");
    }

    const memberId = formData.get("member_id") as string;
    const memberUserId = formData.get("member_user_id") as string;

    if (memberUserId === userId) {
      throw new Error("You cannot remove yourself.");
    }

    const { data: member } = await supabase
      .from("organization_members")
      .select("role")
      .eq("id", memberId)
      .single();

    if (member?.role === "owner") {
      throw new Error("Cannot remove the organization owner.");
    }

    assertSupabaseOk(
      await supabase
        .from("organization_members")
        .delete()
        .eq("id", memberId)
    );

    revalidatePath("/settings");
  }, "removeMemberAction") as unknown as void;
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("org_id") as string;
    const { role } = await validateOrgAccess(orgId);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can revoke invites.");
    }

    const inviteId = formData.get("invite_id") as string;

    assertSupabaseOk(
      await supabase
        .from("organization_invites")
        .delete()
        .eq("id", inviteId)
    );

    revalidatePath("/settings");
  }, "revokeInviteAction") as unknown as void;
}

export async function updateOrgNameAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("org_id") as string;
    const { role } = await validateOrgAccess(orgId);

    if (role !== "owner") {
      throw new Error("Only the owner can rename the organization.");
    }

    const name = formData.get("org_name") as string;

    assertSupabaseOk(
      await supabase
        .from("organizations")
        .update({ name })
        .eq("id", orgId)
    );

    revalidatePath("/settings");
  }, "updateOrgNameAction") as unknown as void;
}
