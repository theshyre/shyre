"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
  const github_token = (formData.get("github_token") as string) || null;

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id: user.id,
      business_name,
      business_email,
      business_address,
      business_phone,
      default_rate,
      invoice_prefix,
      invoice_next_num,
      tax_rate,
      github_token,
    });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
