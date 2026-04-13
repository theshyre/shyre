"use server";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const ctx = await getOrgContext();

  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new Error("Only owners and admins can invite members.");
  }

  const email = formData.get("email") as string;
  const role = (formData.get("role") as string) || "member";

  if (role !== "admin" && role !== "member") {
    throw new Error("Invalid role. Must be admin or member.");
  }

  const { error } = await supabase.from("organization_invites").insert({
    organization_id: ctx.orgId,
    email,
    role,
    invited_by: ctx.userId,
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("This email has already been invited.");
    }
    throw new Error(error.message);
  }

  // In a production app, you'd send an email here with the invite link.
  // For now, the invite token can be shared manually or we can add
  // email sending via Supabase Edge Functions later.

  revalidatePath("/settings");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const ctx = await getOrgContext();

  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new Error("Only owners and admins can remove members.");
  }

  const memberId = formData.get("member_id") as string;
  const memberUserId = formData.get("member_user_id") as string;

  // Can't remove yourself
  if (memberUserId === ctx.userId) {
    throw new Error("You cannot remove yourself.");
  }

  // Can't remove the owner
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("id", memberId)
    .single();

  if (member?.role === "owner") {
    throw new Error("Cannot remove the organization owner.");
  }

  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("id", memberId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const ctx = await getOrgContext();

  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new Error("Only owners and admins can revoke invites.");
  }

  const inviteId = formData.get("invite_id") as string;

  const { error } = await supabase
    .from("organization_invites")
    .delete()
    .eq("id", inviteId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function updateOrgNameAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const ctx = await getOrgContext();

  if (ctx.role !== "owner") {
    throw new Error("Only the owner can rename the organization.");
  }

  const name = formData.get("org_name") as string;

  const { error } = await supabase
    .from("organizations")
    .update({ name })
    .eq("id", ctx.orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
