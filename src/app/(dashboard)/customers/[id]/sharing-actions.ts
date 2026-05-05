"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Pre-flight: caller must be a customer-admin on this customer.
 *  RLS gates the actual write, but a pre-check produces a friendly
 *  error instead of a silent zero-rows-affected. */
async function assertCustomerAdmin(
  supabase: SupabaseClient,
  customerId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("user_customer_permission", {
    p_customer_id: customerId,
  });
  if (error) throw new Error(error.message);
  if (data !== "admin") {
    throw new Error(
      "Only customer admins can manage sharing on this customer.",
    );
  }
}

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
      if (!customerId) throw new Error("Customer ID is required.");

      await assertCustomerAdmin(supabase, customerId);

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
      if (!customerId) throw new Error("Customer ID is required.");

      await assertCustomerAdmin(supabase, customerId);

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
