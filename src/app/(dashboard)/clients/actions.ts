"use server";

import { safeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
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

export const createClientAction = safeAction(async (formData, { supabase }) => {
  const orgId = formData.get("organization_id") as string;
  const { userId } = await validateOrgAccess(orgId);

  const name = formData.get("name") as string;
  const email = (formData.get("email") as string) || null;
  const address = extractAddress(formData, "address");
  const notes = (formData.get("notes") as string) || null;
  const rateStr = formData.get("default_rate") as string;
  const default_rate = rateStr ? parseFloat(rateStr) : null;

  assertSupabaseOk(
    await supabase.from("clients").insert({
      organization_id: orgId,
      user_id: userId,
      name,
      email,
      address,
      notes,
      default_rate,
    })
  );

  revalidatePath("/clients");
}, "createClientAction");

export const updateClientAction = safeAction(async (formData, { supabase }) => {
  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const email = (formData.get("email") as string) || null;
  const address = extractAddress(formData, "address");
  const notes = (formData.get("notes") as string) || null;
  const rateStr = formData.get("default_rate") as string;
  const default_rate = rateStr ? parseFloat(rateStr) : null;

  assertSupabaseOk(
    await supabase
      .from("clients")
      .update({ name, email, address, notes, default_rate })
      .eq("id", id)
  );

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}, "updateClientAction");

export const archiveClientAction = safeAction(async (formData, { supabase }) => {
  const id = formData.get("id") as string;

  assertSupabaseOk(
    await supabase
      .from("clients")
      .update({ archived: true })
      .eq("id", id)
  );

  revalidatePath("/clients");
}, "archiveClientAction");
