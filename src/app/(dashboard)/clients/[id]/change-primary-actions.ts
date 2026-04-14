"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function changePrimaryOrgAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const clientId = formData.get("client_id") as string;
      const newOrgId = formData.get("new_org_id") as string;
      if (!clientId) throw new Error("Client ID is required.");
      if (!newOrgId) throw new Error("New organization is required.");

      const { error } = await supabase.rpc("change_client_primary_org", {
        p_client_id: clientId,
        p_new_org_id: newOrgId,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/clients/${clientId}`);
      revalidatePath("/clients");
    },
    "changePrimaryOrgAction",
  ) as unknown as void;
}
