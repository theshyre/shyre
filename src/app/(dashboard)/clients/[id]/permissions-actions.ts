"use server";

import { runSafeAction } from "@/lib/safe-action";
import { revalidatePath } from "next/cache";

export async function grantPermissionAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const clientId = formData.get("client_id") as string;
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

      if (!clientId) throw new Error("Client ID is required.");
      if (!finalType) throw new Error("Principal type is required.");
      if (!finalId) throw new Error("Principal is required.");
      if (!level) throw new Error("Permission level is required.");

      const { error } = await supabase.rpc("grant_client_permission", {
        p_client_id: clientId,
        p_principal_type: finalType,
        p_principal_id: finalId,
        p_level: level,
      });
      if (error) throw new Error(error.message);

      revalidatePath(`/clients/${clientId}`);
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
      const clientId = formData.get("client_id") as string;
      if (!permissionId) throw new Error("Permission ID is required.");

      const { error } = await supabase
        .from("client_permissions")
        .delete()
        .eq("id", permissionId);
      if (error) throw new Error(error.message);

      revalidatePath(`/clients/${clientId}`);
    },
    "revokePermissionAction",
  ) as unknown as void;
}
