"use server";

import { runSafeAction } from "@/lib/safe-action";
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

    const { error: leaveError, count } = await supabase
      .from("organization_members")
      .delete({ count: "exact" })
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    if (leaveError) throw new Error(leaveError.message);
    if (count === 0) {
      throw new Error("Leave failed — membership was not removed.");
    }

    revalidatePath("/organizations");
    redirect("/organizations");
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

    // Delete and verify it actually happened (RLS may silently return 0 rows)
    const { error: deleteError, count } = await supabase
      .from("organizations")
      .delete({ count: "exact" })
      .eq("id", orgId);

    if (deleteError) throw new Error(deleteError.message);
    if (count === 0) {
      throw new Error(
        "Delete failed — the organization was not removed. You may not have permission to delete it."
      );
    }

    revalidatePath("/organizations");
    redirect("/organizations");
  }, "deleteOrgAction") as unknown as void;
}
