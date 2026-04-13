"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSystemAdmin } from "@/lib/system-admin";
import { revalidatePath } from "next/cache";

export async function resolveErrorAction(formData: FormData): Promise<void> {
  const { userId } = await requireSystemAdmin();
  const supabase = await createClient();

  const errorId = formData.get("error_id") as string;

  const { error } = await supabase
    .from("error_logs")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("id", errorId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/errors");
}
