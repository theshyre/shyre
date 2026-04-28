"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateBusinessAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import {
  blankToNull,
  requiredString,
  validateStateCode,
  readStateRegistrationFields,
  readTaxRegistrationFields,
} from "./registrations-form-parse";

/**
 * Owner|admin gate for registrations-mutating actions. Uses the
 * canonical `validateBusinessAccess` helper instead of the raw RPC
 * — friendly error matches every other Business action.
 */
async function assertBusinessAdmin(businessId: string): Promise<void> {
  const { role } = await validateBusinessAccess(businessId);
  if (role !== "owner" && role !== "admin") {
    throw new Error(
      "Only owners and admins of a team in this business can edit registrations.",
    );
  }
}

function revalidateBusiness(businessId: string): void {
  revalidatePath("/business");
  revalidatePath(`/business/${businessId}`);
}

// ────────────────────────────────────────────────────────────────
// Registered agents
// ────────────────────────────────────────────────────────────────

export async function createRegisteredAgentAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(businessId);

    const state = requiredString(formData, "state").toUpperCase();
    validateStateCode(state);

    assertSupabaseOk(
      await supabase.from("business_registered_agents").insert({
        business_id: businessId,
        name: requiredString(formData, "name"),
        address_line1: requiredString(formData, "address_line1"),
        address_line2: blankToNull(formData.get("address_line2")),
        city: requiredString(formData, "city"),
        state,
        postal_code: requiredString(formData, "postal_code"),
        country: blankToNull(formData.get("country")) ?? "US",
        contact_email: blankToNull(formData.get("contact_email")),
        contact_phone: blankToNull(formData.get("contact_phone")),
        notes: blankToNull(formData.get("notes")),
      }),
    );

    revalidateBusiness(businessId);
  }, "createRegisteredAgentAction") as unknown as void;
}

export async function updateRegisteredAgentAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const agentId = requiredString(formData, "agent_id");
    await assertBusinessAdmin(businessId);

    const state = requiredString(formData, "state").toUpperCase();
    validateStateCode(state);

    assertSupabaseOk(
      await supabase
        .from("business_registered_agents")
        .update({
          name: requiredString(formData, "name"),
          address_line1: requiredString(formData, "address_line1"),
          address_line2: blankToNull(formData.get("address_line2")),
          city: requiredString(formData, "city"),
          state,
          postal_code: requiredString(formData, "postal_code"),
          country: blankToNull(formData.get("country")) ?? "US",
          contact_email: blankToNull(formData.get("contact_email")),
          contact_phone: blankToNull(formData.get("contact_phone")),
          notes: blankToNull(formData.get("notes")),
        })
        .eq("id", agentId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "updateRegisteredAgentAction") as unknown as void;
}

export async function deleteRegisteredAgentAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const agentId = requiredString(formData, "agent_id");
    await assertBusinessAdmin(businessId);

    assertSupabaseOk(
      await supabase
        .from("business_registered_agents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", agentId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "deleteRegisteredAgentAction") as unknown as void;
}

// ────────────────────────────────────────────────────────────────
// State registrations
// ────────────────────────────────────────────────────────────────

export async function createStateRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(businessId);

    const fields = readStateRegistrationFields(formData);

    assertSupabaseOk(
      await supabase.from("business_state_registrations").insert({
        business_id: businessId,
        ...fields,
      }),
    );

    revalidateBusiness(businessId);
  }, "createStateRegistrationAction") as unknown as void;
}

export async function updateStateRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const registrationId = requiredString(formData, "registration_id");
    await assertBusinessAdmin(businessId);

    const fields = readStateRegistrationFields(formData);

    assertSupabaseOk(
      await supabase
        .from("business_state_registrations")
        .update(fields)
        .eq("id", registrationId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "updateStateRegistrationAction") as unknown as void;
}

export async function deleteStateRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const registrationId = requiredString(formData, "registration_id");
    await assertBusinessAdmin(businessId);

    assertSupabaseOk(
      await supabase
        .from("business_state_registrations")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", registrationId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "deleteStateRegistrationAction") as unknown as void;
}

// ────────────────────────────────────────────────────────────────
// Tax registrations
// ────────────────────────────────────────────────────────────────

export async function createTaxRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(businessId);

    const fields = readTaxRegistrationFields(formData);

    assertSupabaseOk(
      await supabase.from("business_tax_registrations").insert({
        business_id: businessId,
        ...fields,
      }),
    );

    revalidateBusiness(businessId);
  }, "createTaxRegistrationAction") as unknown as void;
}

export async function updateTaxRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const registrationId = requiredString(formData, "registration_id");
    await assertBusinessAdmin(businessId);

    const fields = readTaxRegistrationFields(formData);

    assertSupabaseOk(
      await supabase
        .from("business_tax_registrations")
        .update(fields)
        .eq("id", registrationId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "updateTaxRegistrationAction") as unknown as void;
}

export async function deleteTaxRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    const registrationId = requiredString(formData, "registration_id");
    await assertBusinessAdmin(businessId);

    assertSupabaseOk(
      await supabase
        .from("business_tax_registrations")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", registrationId)
        .eq("business_id", businessId),
    );

    revalidateBusiness(businessId);
  }, "deleteTaxRegistrationAction") as unknown as void;
}
