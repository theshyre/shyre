"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function grantPermissionAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const customerId = formData.get("customer_id") as string;
      const principalRaw = formData.get("principal") as string;
      const principalType = formData.get("principal_type") as
        | "user"
        | "group"
        | null;
      const principalIdField = formData.get("principal_id") as string | null;
      const level = formData.get("permission_level") as
        | "viewer"
        | "contributor"
        | "admin";

      // Support combined "user:uuid" / "group:uuid" field, or separate fields.
      let finalType: "user" | "group" | null = principalType ?? null;
      let finalId: string | null = principalIdField ?? null;
      if (principalRaw && principalRaw.includes(":")) {
        const [t, id] = principalRaw.split(":");
        finalType = (t === "user" || t === "group" ? t : null) as
          | "user"
          | "group"
          | null;
        finalId = id ?? null;
      }

      if (!customerId) throw new Error("Client ID is required.");
      if (!finalType) throw new Error("Principal type is required.");
      if (!finalId) throw new Error("Principal is required.");
      if (!level) throw new Error("Permission level is required.");

      const { error } = await supabase.rpc("grant_customer_permission", {
        p_customer_id: customerId,
        p_principal_type: finalType,
        p_principal_id: finalId,
        p_level: level,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/customers/${customerId}`);
    },
    "grantPermissionAction",
  ) as unknown as void;
}

export async function revokePermissionAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const permissionId = formData.get("permission_id") as string;
      const customerId = formData.get("customer_id") as string;
      if (!permissionId) throw new Error("Permission ID is required.");
      if (!customerId) throw new Error("Customer ID is required.");

      // Defense-in-depth role check at the action boundary. RLS would
      // also block a non-admin (zero rows affected, silent), but a
      // pre-flight check produces a friendly error and keeps the
      // forms-and-buttons promise of "look like the state you're in"
      // (see SAL-013 lineage).
      const { data: roleRow, error: roleErr } = await supabase.rpc(
        "user_customer_permission",
        { p_customer_id: customerId },
      );
      if (roleErr) throw new Error(roleErr.message);
      if (roleRow !== "admin") {
        throw new Error(
          "Only customer admins can revoke permissions on this customer.",
        );
      }

      const { error } = await supabase
        .from("customer_permissions")
        .delete()
        .eq("id", permissionId);
      if (error) throw new Error(error.message);

      revalidatePath(`/customers/${customerId}`);
    },
    "revokePermissionAction",
  ) as unknown as void;
}
