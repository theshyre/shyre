"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function changePrimaryTeamAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const customerId = formData.get("customer_id") as string;
      const newTeamId = formData.get("new_team_id") as string;
      if (!customerId) throw new Error("Client ID is required.");
      if (!newTeamId) throw new Error("New team is required.");

      const { error } = await supabase.rpc("change_customer_primary_team", {
        p_customer_id: customerId,
        p_new_team_id: newTeamId,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/customers/${customerId}`);
      revalidatePath("/customers");
    },
    "changePrimaryTeamAction",
  ) as unknown as void;
}
