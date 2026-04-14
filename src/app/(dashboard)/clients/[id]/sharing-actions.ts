"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function addClientShareAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const clientId = formData.get("client_id") as string;
      const organizationId = formData.get("organization_id") as string;
      const canSeeOthers = formData.get("can_see_others") === "on";

      if (!clientId) throw new Error("Client ID is required.");
      if (!organizationId) throw new Error("Organization is required.");

      const { error } = await supabase.rpc("add_client_share", {
        p_client_id: clientId,
        p_org_id: organizationId,
        p_can_see_others: canSeeOthers,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/clients/${clientId}`);
    },
    "addClientShareAction",
  ) as unknown as void;
}

export async function removeClientShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const clientId = formData.get("client_id") as string;
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase
        .from("client_shares")
        .delete()
        .eq("id", shareId);
      if (error) throw new Error(error.message);

      revalidatePath(`/clients/${clientId}`);
    },
    "removeClientShareAction",
  ) as unknown as void;
}

export async function updateShareVisibilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const clientId = formData.get("client_id") as string;
      const canSeeOthers = formData.get("can_see_others") === "on";
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase
        .from("client_shares")
        .update({ can_see_others_entries: canSeeOthers })
        .eq("id", shareId);
      if (error) throw new Error(error.message);

      revalidatePath(`/clients/${clientId}`);
    },
    "updateShareVisibilityAction",
  ) as unknown as void;
}
