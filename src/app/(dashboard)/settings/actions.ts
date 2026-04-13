"use server";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function updateOrgSettingsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { orgId, role } = await getOrgContext();

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners and admins can update organization settings.");
  }

  const business_name = (formData.get("business_name") as string) || null;
  const business_email = (formData.get("business_email") as string) || null;
  const business_address = (formData.get("business_address") as string) || null;
  const business_phone = (formData.get("business_phone") as string) || null;
  const rateStr = formData.get("default_rate") as string;
  const default_rate = rateStr ? parseFloat(rateStr) : 0;
  const invoice_prefix = (formData.get("invoice_prefix") as string) || "INV";
  const numStr = formData.get("invoice_next_num") as string;
  const invoice_next_num = numStr ? parseInt(numStr, 10) : 1;
  const taxStr = formData.get("tax_rate") as string;
  const tax_rate = taxStr ? parseFloat(taxStr) : 0;

  const { error } = await supabase
    .from("organization_settings")
    .upsert({
      organization_id: orgId,
      business_name,
      business_email,
      business_address,
      business_phone,
      default_rate,
      invoice_prefix,
      invoice_next_num,
      tax_rate,
    });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function updateUserSettingsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { userId } = await getOrgContext();

  const github_token = (formData.get("github_token") as string) || null;

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id: userId,
      github_token,
    });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
