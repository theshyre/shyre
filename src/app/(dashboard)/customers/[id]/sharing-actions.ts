"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function addCustomerShareAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const customerId = formData.get("customer_id") as string;
      const organizationId = formData.get("team_id") as string;
      const canSeeOthers = formData.get("can_see_others") === "on";

      if (!customerId) throw new Error("Client ID is required.");
      if (!organizationId) throw new Error("Team is required.");

      const { error } = await supabase.rpc("add_customer_share", {
        p_customer_id: customerId,
        p_team_id: organizationId,
        p_can_see_others: canSeeOthers,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/customers/${customerId}`);
    },
    "addCustomerShareAction",
  ) as unknown as void;
}

export async function removeCustomerShareAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const customerId = formData.get("customer_id") as string;
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase
        .from("customer_shares")
        .delete()
        .eq("id", shareId);
      if (error) throw new Error(error.message);

      revalidatePath(`/customers/${customerId}`);
    },
    "removeCustomerShareAction",
  ) as unknown as void;
}

export async function updateShareVisibilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const shareId = formData.get("share_id") as string;
      const customerId = formData.get("customer_id") as string;
      const canSeeOthers = formData.get("can_see_others") === "on";
      if (!shareId) throw new Error("Share ID is required.");

      const { error } = await supabase
        .from("customer_shares")
        .update({ can_see_others_entries: canSeeOthers })
        .eq("id", shareId);
      if (error) throw new Error(error.message);

      revalidatePath(`/customers/${customerId}`);
    },
    "updateShareVisibilityAction",
  ) as unknown as void;
}
