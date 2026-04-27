/**
 * Pure types + label maps for the identity-history surface. Lives
 * outside `actions.ts` because that file is `"use server"` and
 * Next.js only permits async-function exports there. Splitting these
 * out keeps both the action file and the page/route consumers tidy.
 */

export const BUSINESS_FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  entity_type: "Entity type",
  tax_id: "Tax ID (EIN)",
  date_incorporated: "Date incorporated",
  fiscal_year_start: "Fiscal year start",
};

export const REGISTRATION_FIELD_LABELS: Record<string, string> = {
  state: "State",
  is_formation: "Formation entity",
  registration_type: "Registration type",
  entity_number: "Entity number",
  state_tax_id: "State tax ID",
  registered_on: "Registered on",
  nexus_start_date: "Nexus start date",
  registration_status: "Status",
  withdrawn_on: "Withdrawn on",
  revoked_on: "Revoked on",
  report_frequency: "Report frequency",
  due_rule: "Due rule",
  annual_report_due_mmdd: "Annual report due (MM-DD)",
  next_due_date: "Next due date",
  annual_report_fee_cents: "Annual report fee (cents)",
  registered_agent_id: "Registered agent",
  notes: "Notes",
  deleted_at: "Deleted at",
};

export const IDENTITY_HISTORY_HIDDEN_KEYS = new Set([
  "id",
  "business_id",
  "created_at",
  "updated_at",
  "created_by_user_id",
  "updated_by_user_id",
]);

export interface IdentityHistoryEntry {
  id: string;
  /** Discriminator: which table the row came from. */
  kind: "business" | "registration";
  /** For registrations, identifies which registration this is about
   *  (the row's id). Empty string for `kind: 'business'`. */
  registrationId: string;
  /** Short human label for the source row. */
  rowLabel: string;
  operation: "UPDATE" | "DELETE";
  changedAt: string;
  changedBy: {
    userId: string | null;
    displayName: string | null;
    email: string | null;
  };
  previousState: Record<string, unknown>;
}

/** Raw `businesses_history` row shape (the columns the action reads). */
export interface RawBusinessHistoryRow {
  id: string;
  operation: "UPDATE" | "DELETE";
  changed_at: string;
  changed_by_user_id: string | null;
  previous_state: Record<string, unknown> | null;
}

/** Raw `business_state_registrations_history` row shape. */
export interface RawRegistrationHistoryRow extends RawBusinessHistoryRow {
  registration_id: string;
}

/** Map a raw `businesses_history` DB row to an IdentityHistoryEntry.
 *  `liveBusinessName` is the current legal_name of the business —
 *  used as the rowLabel fallback when the snapshot's legal_name is
 *  missing. */
export function buildBusinessHistoryEntry(
  row: RawBusinessHistoryRow,
  liveBusinessName: string,
): IdentityHistoryEntry {
  const prev = row.previous_state ?? {};
  const snapshotName =
    typeof prev.legal_name === "string" ? prev.legal_name : null;
  return {
    id: row.id,
    kind: "business",
    registrationId: "",
    rowLabel: snapshotName ?? liveBusinessName,
    operation: row.operation,
    changedAt: row.changed_at,
    changedBy: {
      userId: row.changed_by_user_id,
      displayName: null,
      email: null,
    },
    previousState: prev,
  };
}

/** Map a raw `business_state_registrations_history` DB row to an
 *  IdentityHistoryEntry. The rowLabel reads the state + registration
 *  type from the snapshot so a deleted registration still has a
 *  meaningful label. */
export function buildRegistrationHistoryEntry(
  row: RawRegistrationHistoryRow,
): IdentityHistoryEntry {
  const prev = row.previous_state ?? {};
  const state = typeof prev.state === "string" ? prev.state : "—";
  const regType =
    typeof prev.registration_type === "string"
      ? prev.registration_type.replace(/_/g, " ")
      : "registration";
  return {
    id: row.id,
    kind: "registration",
    registrationId: row.registration_id,
    rowLabel: `${state} — ${regType}`,
    operation: row.operation,
    changedAt: row.changed_at,
    changedBy: {
      userId: row.changed_by_user_id,
      displayName: null,
      email: null,
    },
    previousState: prev,
  };
}

/** Merge raw rows from both tables into a single newest-first list.
 *  Sort is stable on equal `changed_at`. Pure function — used both
 *  by the page action and by the CSV route, and by its own tests. */
export function mergeIdentityHistoryRows(args: {
  businessRows: RawBusinessHistoryRow[];
  registrationRows: RawRegistrationHistoryRow[];
  liveBusinessName: string;
}): IdentityHistoryEntry[] {
  const businessEntries = args.businessRows.map((r) =>
    buildBusinessHistoryEntry(r, args.liveBusinessName),
  );
  const registrationEntries = args.registrationRows.map((r) =>
    buildRegistrationHistoryEntry(r),
  );
  return [...businessEntries, ...registrationEntries].sort((a, b) =>
    b.changedAt.localeCompare(a.changedAt),
  );
}

/** Stable group key for diffing — distinguishes "the business
 *  identity row" from each individual state-registration row so a
 *  business UPDATE doesn't accidentally diff against a registration
 *  UPDATE. Used by both the timeline component and the CSV route. */
export function identityGroupKey(entry: IdentityHistoryEntry): string {
  return entry.kind === "business"
    ? "business:"
    : `registration:${entry.registrationId}`;
}
