"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createOrgAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const name = formData.get("org_name") as string;
    if (!name || name.trim().length === 0) {
      throw new Error("Organization name is required.");
    }

    // Atomic creation via SECURITY DEFINER function — handles RLS correctly
    const { error } = await supabase.rpc("create_organization", {
      org_name: name.trim(),
    });

    if (error) throw new Error(error.message);

    revalidatePath("/");
    redirect("/organizations");
  }, "createOrgAction") as unknown as void;
}

export async function leaveOrgAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
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

    assertSupabaseOk(
      await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", userId)
    );

    revalidatePath("/");
    redirect("/");
  }, "leaveOrgAction") as unknown as void;
}

export async function deleteOrgAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
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

    assertSupabaseOk(
      await supabase
        .from("organizations")
        .delete()
        .eq("id", orgId)
    );

    revalidatePath("/");
    redirect("/");
  }, "deleteOrgAction") as unknown as void;
}
