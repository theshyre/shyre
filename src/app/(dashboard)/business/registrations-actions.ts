"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import {
  ALLOWED_REGISTRATION_TYPES,
  ALLOWED_REGISTRATION_STATUSES,
  ALLOWED_REPORT_FREQUENCIES,
  ALLOWED_DUE_RULES,
  ALLOWED_TAX_TYPES,
  ALLOWED_TAX_REGISTRATION_STATUSES,
  ALLOWED_FILING_FREQUENCIES,
} from "./registrations-allow-lists";

type SBClient = import("@supabase/supabase-js").SupabaseClient;

// ────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────

function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function requiredString(
  formData: FormData,
  name: string,
): string {
  const v = blankToNull(formData.get(name));
  if (!v) throw new Error(`${name} is required.`);
  return v;
}

function optionalInt(v: FormDataEntryValue | null): number | null {
  const s = blankToNull(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid integer: ${s}`);
  }
  return n;
}

function validateStateCode(state: string): void {
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new Error(`State must be a two-letter USPS code, got: ${state}`);
  }
}

function validateMmDd(v: string | null): void {
  if (v !== null && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) {
    throw new Error(`Expected MM-DD, got: ${v}`);
  }
}

/**
 * Assert the current user is an owner/admin of the given business —
 * derived via user_business_role(). We re-check on the app side for
 * a friendly error; RLS enforces the same on the DB side.
 */
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
    await assertBusinessAdmin(supabase, businessId);

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
    await assertBusinessAdmin(supabase, businessId);

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
    await assertBusinessAdmin(supabase, businessId);

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

function readStateRegistrationFields(formData: FormData): {
  state: string;
  is_formation: boolean;
  registration_type: string;
  entity_number: string | null;
  state_tax_id: string | null;
  registered_on: string | null;
  nexus_start_date: string | null;
  registration_status: string;
  withdrawn_on: string | null;
  revoked_on: string | null;
  report_frequency: string | null;
  due_rule: string | null;
  annual_report_due_mmdd: string | null;
  next_due_date: string | null;
  annual_report_fee_cents: number | null;
  registered_agent_id: string | null;
  notes: string | null;
} {
  const state = requiredString(formData, "state").toUpperCase();
  validateStateCode(state);

  const registration_type = requiredString(formData, "registration_type");
  if (!ALLOWED_REGISTRATION_TYPES.has(registration_type)) {
    throw new Error(`Invalid registration_type: ${registration_type}`);
  }

  const registration_status =
    blankToNull(formData.get("registration_status")) ?? "pending";
  if (!ALLOWED_REGISTRATION_STATUSES.has(registration_status)) {
    throw new Error(`Invalid registration_status: ${registration_status}`);
  }

  const report_frequency = blankToNull(formData.get("report_frequency"));
  if (report_frequency && !ALLOWED_REPORT_FREQUENCIES.has(report_frequency)) {
    throw new Error(`Invalid report_frequency: ${report_frequency}`);
  }

  const due_rule = blankToNull(formData.get("due_rule"));
  if (due_rule && !ALLOWED_DUE_RULES.has(due_rule)) {
    throw new Error(`Invalid due_rule: ${due_rule}`);
  }

  const annual_report_due_mmdd = blankToNull(
    formData.get("annual_report_due_mmdd"),
  );
  validateMmDd(annual_report_due_mmdd);

  const is_formation = formData.get("is_formation") === "true";
  if (is_formation && registration_type !== "domestic") {
    throw new Error(
      "A formation registration must have registration_type 'domestic'.",
    );
  }

  return {
    state,
    is_formation,
    registration_type,
    entity_number: blankToNull(formData.get("entity_number")),
    state_tax_id: blankToNull(formData.get("state_tax_id")),
    registered_on: blankToNull(formData.get("registered_on")),
    nexus_start_date: blankToNull(formData.get("nexus_start_date")),
    registration_status,
    withdrawn_on: blankToNull(formData.get("withdrawn_on")),
    revoked_on: blankToNull(formData.get("revoked_on")),
    report_frequency,
    due_rule,
    annual_report_due_mmdd,
    next_due_date: blankToNull(formData.get("next_due_date")),
    annual_report_fee_cents: optionalInt(
      formData.get("annual_report_fee_cents"),
    ),
    registered_agent_id: blankToNull(formData.get("registered_agent_id")),
    notes: blankToNull(formData.get("notes")),
  };
}

export async function createStateRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(supabase, businessId);

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
    await assertBusinessAdmin(supabase, businessId);

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
    await assertBusinessAdmin(supabase, businessId);

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

function readTaxRegistrationFields(formData: FormData): {
  state: string;
  tax_type: string;
  permit_number: string | null;
  registered_on: string | null;
  nexus_start_date: string | null;
  tax_registration_status: string;
  closed_on: string | null;
  filing_frequency: string | null;
  next_filing_due: string | null;
  notes: string | null;
} {
  const state = requiredString(formData, "state").toUpperCase();
  validateStateCode(state);

  const tax_type = requiredString(formData, "tax_type");
  if (!ALLOWED_TAX_TYPES.has(tax_type)) {
    throw new Error(`Invalid tax_type: ${tax_type}`);
  }

  const tax_registration_status =
    blankToNull(formData.get("tax_registration_status")) ?? "pending";
  if (!ALLOWED_TAX_REGISTRATION_STATUSES.has(tax_registration_status)) {
    throw new Error(
      `Invalid tax_registration_status: ${tax_registration_status}`,
    );
  }

  const filing_frequency = blankToNull(formData.get("filing_frequency"));
  if (filing_frequency && !ALLOWED_FILING_FREQUENCIES.has(filing_frequency)) {
    throw new Error(`Invalid filing_frequency: ${filing_frequency}`);
  }

  return {
    state,
    tax_type,
    permit_number: blankToNull(formData.get("permit_number")),
    registered_on: blankToNull(formData.get("registered_on")),
    nexus_start_date: blankToNull(formData.get("nexus_start_date")),
    tax_registration_status,
    closed_on: blankToNull(formData.get("closed_on")),
    filing_frequency,
    next_filing_due: blankToNull(formData.get("next_filing_due")),
    notes: blankToNull(formData.get("notes")),
  };
}

export async function createTaxRegistrationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const businessId = requiredString(formData, "business_id");
    await assertBusinessAdmin(supabase, businessId);

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
    await assertBusinessAdmin(supabase, businessId);

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
    await assertBusinessAdmin(supabase, businessId);

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

