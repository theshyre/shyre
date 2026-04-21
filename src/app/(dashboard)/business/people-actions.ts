"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import {
  readPersonFields,
  requiredString,
} from "./people-form-parse";

type SBClient = import("@supabase/supabase-js").SupabaseClient;

async function assertBusinessAdmin(
  supabase: SBClient,
  businessId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("user_business_role", {
    business_id: businessId,
  });
  if (error) throw error;
  if (data !== "owner" && data !== "admin") {
    throw new Error(
      "Only owners and admins of a team in this business can manage people.",
    );
  }
}

function revalidateBusiness(businessId: string): void {
  revalidatePath("/business");
  revalidatePath(`/business/${businessId}`);
}

export async function createPersonAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(supabase, businessId);

    const fields = readPersonFields(formData);

    assertSupabaseOk(
      await supabase.from("business_people").insert({
        business_id: businessId,
        ...fields,
      }),
    );

    revalidateBusiness(businessId);
  }, "createPersonAction") as unknown as void;
}

export async function updatePersonAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const personId = requiredString(formData, "person_id");
    await assertBusinessAdmin(supabase, businessId);

    const fields = readPersonFields(formData);

    assertSupabaseOk(
      await supabase
        .from("business_people")
        .update(fields)
        .eq("id", personId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "updatePersonAction") as unknown as void;
}

export async function deletePersonAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const personId = requiredString(formData, "person_id");
    await assertBusinessAdmin(supabase, businessId);

    assertSupabaseOk(
      await supabase
        .from("business_people")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", personId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "deletePersonAction") as unknown as void;
}
