/**
 * Pure parsing + validation helpers for the business_people form.
 *
 * Lives in its own module (not under "use server") so it can be
 * unit-tested without pulling the server-action runtime. The server
 * actions in people-actions.ts re-export these through runSafeAction
 * wrappers; tests target this file directly.
 */

import {
  ALLOWED_EMPLOYMENT_TYPES,
  ALLOWED_COMPENSATION_TYPES,
  ALLOWED_COMPENSATION_SCHEDULES,
} from "./people-allow-lists";

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

export interface PersonFields {
  user_id: string | null;
  legal_name: string;
  preferred_name: string | null;
  work_email: string | null;
  work_phone: string | null;
  employment_type: string;
  title: string | null;
  department: string | null;
  employee_number: string | null;
  started_on: string | null;
  ended_on: string | null;
  compensation_type: string | null;
  compensation_amount_cents: number | null;
  compensation_currency: string | null;
  compensation_schedule: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  reports_to_person_id: string | null;
  notes: string | null;
}

export function readPersonFields(formData: FormData): PersonFields {
  const employment_type = requiredString(formData, "employment_type");
  if (!ALLOWED_EMPLOYMENT_TYPES.has(employment_type)) {
    throw new Error(`Invalid employment_type: ${employment_type}`);
  }

  const compensation_type = blankToNull(formData.get("compensation_type"));
  if (compensation_type && !ALLOWED_COMPENSATION_TYPES.has(compensation_type)) {
    throw new Error(`Invalid compensation_type: ${compensation_type}`);
  }

  const compensation_schedule = blankToNull(
    formData.get("compensation_schedule"),
  );
  if (
    compensation_schedule &&
    !ALLOWED_COMPENSATION_SCHEDULES.has(compensation_schedule)
  ) {
    throw new Error(`Invalid compensation_schedule: ${compensation_schedule}`);
  }

  const state = blankToNull(formData.get("state"));
  if (state && !/^[A-Z]{2}$/.test(state.toUpperCase())) {
    throw new Error(`State must be a two-letter USPS code, got: ${state}`);
  }

  const compAmountRaw = blankToNull(formData.get("compensation_amount"));
  let compensation_amount_cents: number | null = null;
  if (compAmountRaw !== null) {
    const n = Number(compAmountRaw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`Invalid compensation_amount: ${compAmountRaw}`);
    }
    compensation_amount_cents = Math.round(n * 100);
  } else {
    compensation_amount_cents = optionalInt(
      formData.get("compensation_amount_cents"),
    );
  }

  return {
    user_id: blankToNull(formData.get("user_id")),
    legal_name: requiredString(formData, "legal_name"),
    preferred_name: blankToNull(formData.get("preferred_name")),
    work_email: blankToNull(formData.get("work_email")),
    work_phone: blankToNull(formData.get("work_phone")),
    employment_type,
    title: blankToNull(formData.get("title")),
    department: blankToNull(formData.get("department")),
    employee_number: blankToNull(formData.get("employee_number")),
    started_on: blankToNull(formData.get("started_on")),
    ended_on: blankToNull(formData.get("ended_on")),
    compensation_type,
    compensation_amount_cents,
    compensation_currency: blankToNull(formData.get("compensation_currency")),
    compensation_schedule,
    address_line1: blankToNull(formData.get("address_line1")),
    address_line2: blankToNull(formData.get("address_line2")),
    city: blankToNull(formData.get("city")),
    state: state ? state.toUpperCase() : null,
    postal_code: blankToNull(formData.get("postal_code")),
    country: blankToNull(formData.get("country")),
    reports_to_person_id: blankToNull(formData.get("reports_to_person_id")),
    notes: blankToNull(formData.get("notes")),
  };
}
