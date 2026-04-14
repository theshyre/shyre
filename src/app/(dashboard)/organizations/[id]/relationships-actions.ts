"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function proposeOrgShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const parentOrgId = formData.get("parent_org_id") as string;
      const childOrgId = formData.get("child_org_id") as string;
      const sharingLevel = formData.get("sharing_level") as string;

      if (!parentOrgId) throw new Error("Parent organization is required.");
      if (!childOrgId) throw new Error("Child organization is required.");
      if (!sharingLevel) throw new Error("Sharing level is required.");

      const { error } = await supabase.rpc("propose_organization_share", {
        p_parent_org_id: parentOrgId,
        p_child_org_id: childOrgId,
        p_sharing_level: sharingLevel,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/organizations/${parentOrgId}`);
      revalidatePath(`/organizations/${childOrgId}`);
    },
    "proposeOrgShareAction",
  ) as unknown as void;
}

export async function acceptOrgShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const orgId = formData.get("org_id") as string;
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase.rpc("accept_organization_share", {
        p_share_id: shareId,
      });
      if (error) throw new Error(error.message);

      if (orgId) revalidatePath(`/organizations/${orgId}`);
    },
    "acceptOrgShareAction",
  ) as unknown as void;
}

export async function removeOrgShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const orgId = formData.get("org_id") as string;
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase
        .from("organization_shares")
        .delete()
        .eq("id", shareId);
      if (error) throw new Error(error.message);

      if (orgId) revalidatePath(`/organizations/${orgId}`);
    },
    "removeOrgShareAction",
  ) as unknown as void;
}
