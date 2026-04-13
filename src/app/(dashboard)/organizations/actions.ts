"use server";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export async function createOrgAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = formData.get("org_name") as string;
  if (!name || name.trim().length === 0) {
    throw new Error("Organization name is required.");
  }

  const baseSlug = slugify(name);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  // Create org
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: name.trim(), slug, is_personal: false })
    .select("id")
    .single();

  if (orgError || !org) {
    throw new Error(orgError?.message ?? "Failed to create organization.");
  }

  // Make creator the owner
  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });

  if (memberError) throw new Error(memberError.message);

  // Create org settings with defaults
  const { error: settingsError } = await supabase
    .from("organization_settings")
    .insert({ organization_id: org.id });

  if (settingsError) throw new Error(settingsError.message);

  // Switch to new org
  const cookieStore = await cookies();
  cookieStore.set("stint-org-id", org.id, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/");
  redirect("/");
}

export async function leaveOrgAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  const orgId = formData.get("org_id") as string;

  if (orgId !== ctx.orgId) {
    throw new Error("Cannot leave an org you're not currently viewing.");
  }

  // Cannot leave personal org
  if (ctx.isPersonalOrg) {
    throw new Error("Cannot leave your personal organization.");
  }

  // Cannot leave if sole owner
  if (ctx.role === "owner") {
    const { data: owners } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("role", "owner");

    if (!owners || owners.length <= 1) {
      throw new Error("Transfer ownership before leaving. You are the sole owner.");
    }
  }

  // Remove membership
  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", ctx.userId);

  if (error) throw new Error(error.message);

  // Switch to personal org
  const { data: personalMembership } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(is_personal)")
    .eq("user_id", ctx.userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  const personalOrgId = personalMembership?.organization_id;

  const cookieStore = await cookies();
  if (personalOrgId) {
    cookieStore.set("stint-org-id", personalOrgId, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookieStore.delete("stint-org-id");
  }

  revalidatePath("/");
  redirect("/");
}

export async function deleteOrgAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  const orgId = formData.get("org_id") as string;
  const confirmName = formData.get("confirm_name") as string;

  if (orgId !== ctx.orgId) {
    throw new Error("Cannot delete an org you're not currently viewing.");
  }

  if (ctx.isPersonalOrg) {
    throw new Error("Cannot delete your personal organization.");
  }

  if (ctx.role !== "owner") {
    throw new Error("Only the owner can delete an organization.");
  }

  if (confirmName !== ctx.orgName) {
    throw new Error("Organization name does not match. Deletion cancelled.");
  }

  // Delete org (cascades to members, settings, and all data)
  const { error } = await supabase
    .from("organizations")
    .delete()
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  // Switch to personal org
  const { data: personalMembership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", ctx.userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .single();

  const cookieStore = await cookies();
  if (personalMembership) {
    cookieStore.set("stint-org-id", personalMembership.organization_id, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookieStore.delete("stint-org-id");
  }

  revalidatePath("/");
  redirect("/");
}
