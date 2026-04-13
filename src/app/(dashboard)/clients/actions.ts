"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createClientAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = formData.get("name") as string;
  const email = (formData.get("email") as string) || null;
  const address = (formData.get("address") as string) || null;
  const notes = (formData.get("notes") as string) || null;
  const rateStr = formData.get("default_rate") as string;
  const default_rate = rateStr ? parseFloat(rateStr) : null;

  const { error } = await supabase.from("clients").insert({
    user_id: user.id,
    name,
    email,
    address,
    notes,
    default_rate,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}

export async function updateClientAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function archiveClientAction(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("clients")
    .update({ archived: true })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}
