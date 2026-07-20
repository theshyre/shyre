/**
 * Domain data for the `business_people` history diff: which columns
 * get a label (and therefore render in the timeline) and which are
 * hidden noise (internal ids, audit timestamps). The generic
 * diff/format mechanics that consume these live in
 * `@/lib/history/format` — this file supplies only the module-owned
 * data, per the expenses-primitives playbook in
 * `docs/reference/modules.md`.
 */

/** Field-label map for keys we surface in the diff. Anything not in
 *  this map is hidden — `business_people` columns we explicitly
 *  don't want a reader to see in the timeline (internal ids, audit
 *  timestamps) just won't have a label and therefore won't render. */
export const FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  preferred_name: "Preferred name",
  work_email: "Work email",
  work_phone: "Work phone",
  employment_type: "Employment type",
  title: "Title",
  department: "Department",
  employee_number: "Employee number",
  started_on: "Started",
  ended_on: "Ended",
  compensation_type: "Compensation type",
  compensation_amount_cents: "Compensation amount (cents)",
  compensation_currency: "Compensation currency",
  compensation_schedule: "Compensation schedule",
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  city: "City",
  state: "State",
  postal_code: "Postal code",
  country: "Country",
  reports_to_person_id: "Reports to",
  notes: "Notes",
  user_id: "Linked Shyre user",
  deleted_at: "Deleted at",
};

/** Columns we filter out of the "previous values" listing for the
 *  most-recent (no-newer-neighbor) entry. These don't help a reader
 *  understand the change. */
export const HIDDEN_KEYS = new Set([
  "id",
  "business_id",
  "created_at",
  "updated_at",
  "created_by_user_id",
  "updated_by_user_id",
]);
