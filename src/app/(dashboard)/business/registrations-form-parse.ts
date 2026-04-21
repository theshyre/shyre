/**
 * Pure parsing + validation helpers for the business state / tax
 * registration forms. Lives in its own module (not under "use server")
 * so it can be unit-tested without pulling the server-action runtime.
 */

import {
  ALLOWED_REGISTRATION_STATUSES,
  ALLOWED_REPORT_FREQUENCIES,
  ALLOWED_DUE_RULES,
  ALLOWED_TAX_TYPES,
  ALLOWED_TAX_REGISTRATION_STATUSES,
  ALLOWED_FILING_FREQUENCIES,
} from "./registrations-allow-lists";

export function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function requiredString(formData: FormData, name: string): string {
  const v = blankToNull(formData.get(name));
  if (!v) throw new Error(`${name} is required.`);
  return v;
}

export function optionalInt(v: FormDataEntryValue | null): number | null {
  const s = blankToNull(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid integer: ${s}`);
  }
  return n;
}

export function validateStateCode(state: string): void {
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new Error(`State must be a two-letter USPS code, got: ${state}`);
  }
}

export function validateMmDd(v: string | null): void {
  if (v !== null && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) {
    throw new Error(`Expected MM-DD, got: ${v}`);
  }
}

export function readStateRegistrationFields(formData: FormData): {
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
  const registration_type = is_formation ? "domestic" : "foreign_qualification";

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

export function readTaxRegistrationFields(formData: FormData): {
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
