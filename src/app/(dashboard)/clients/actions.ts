"use server";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function createClientAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { orgId, userId } = await getOrgContext();

  const name = formData.get("name") as string;
  const email = (formData.get("email") as string) || null;
  const address = (formData.get("address") as string) || null;
  const notes = (formData.get("notes") as string) || null;
  const rateStr = formData.get("default_rate") as string;
  const default_rate = rateStr ? parseFloat(rateStr) : null;

  const { error } = await supabase.from("clients").insert({
    organization_id: orgId,
    user_id: userId,
    name,
    email,
    address,
    notes,
    default_rate,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}

export async function updateClientAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { orgId } = await getOrgContext();

  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const email = (formData.get("email") as string) || null;
  const address = (formData.get("address") as string) || null;
  const notes = (formData.get("notes") as string) || null;
  const rateStr = formData.get("default_rate") as string;
  const default_rate = rateStr ? parseFloat(rateStr) : null;

  const { error } = await supabase
    .from("clients")
    .update({ name, email, address, notes, default_rate })
    .eq("organization_id", orgId)
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { orgId } = await getOrgContext();

  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("clients")
    .update({ archived: true })
    .eq("organization_id", orgId)
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}
