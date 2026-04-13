"use server";

import { createClient } from "@/lib/supabase/server";
import { validateOrgAccess } from "@/lib/org-context";
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

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: name.trim(), slug, is_personal: false })
    .select("id")
    .single();

  if (orgError || !org) {
    throw new Error(orgError?.message ?? "Failed to create organization.");
  }

  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });

  if (memberError) throw new Error(memberError.message);

  const { error: settingsError } = await supabase
    .from("organization_settings")
    .insert({ organization_id: org.id });

  if (settingsError) throw new Error(settingsError.message);

  revalidatePath("/");
  redirect("/");
}

export async function leaveOrgAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const orgId = formData.get("org_id") as string;
  const { userId, role } = await validateOrgAccess(orgId);

  // Cannot leave if sole owner
  if (role === "owner") {
    const { data: owners } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("role", "owner");

    if (!owners || owners.length <= 1) {
      throw new Error("Transfer ownership before leaving. You are the sole owner.");
    }
  }

  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  revalidatePath("/");
  redirect("/");
}

export async function deleteOrgAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const orgId = formData.get("org_id") as string;
  const confirmName = formData.get("confirm_name") as string;
  const { role } = await validateOrgAccess(orgId);

  if (role !== "owner") {
    throw new Error("Only the owner can delete an organization.");
  }

  // Verify org name matches
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  if (!org || confirmName !== org.name) {
    throw new Error("Organization name does not match. Deletion cancelled.");
  }

  const { error } = await supabase
    .from("organizations")
    .delete()
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  revalidatePath("/");
  redirect("/");
}
