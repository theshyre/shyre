"use server";

import { createClient } from "@/lib/supabase/server";
import { validateOrgAccess } from "@/lib/org-context";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serializeAddress } from "@/lib/schemas/address";

function extractAddress(formData: FormData, prefix: string): string | null {
  const address = {
    street: (formData.get(`${prefix}.street`) as string) || "",
    street2: (formData.get(`${prefix}.street2`) as string) || "",
    city: (formData.get(`${prefix}.city`) as string) || "",
    state: (formData.get(`${prefix}.state`) as string) || "",
    postalCode: (formData.get(`${prefix}.postalCode`) as string) || "",
    country: (formData.get(`${prefix}.country`) as string) || "",
  };
  return serializeAddress(address);
}

export async function updateOrgSettingsAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const orgId = formData.get("organization_id") as string;
  const { role } = await validateOrgAccess(orgId);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners and admins can update organization settings.");
  }

  const business_name = (formData.get("business_name") as string) || null;
  const business_email = (formData.get("business_email") as string) || null;
  const business_address = extractAddress(formData, "business_address");
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const github_token = (formData.get("github_token") as string) || null;

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id: user.id,
      github_token,
    });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const display_name = (formData.get("display_name") as string) || null;

  const { error } = await supabase
    .from("user_profiles")
    .upsert({
      user_id: user.id,
      display_name,
    });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/");
}
