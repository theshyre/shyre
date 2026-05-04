/**
 * Pure parsing + row-building helpers for the Harvest importer.
 *
 * Lives separately from the route and from harvest.ts (the API client)
 * so the non-trivial logic — time-zone resolution, task→category
 * mapping, user mapping, audit-trail stitching — can be unit-tested
 * without spinning up a Supabase client or Next request context.
 *
 * Key invariant: no function in this module touches `new Date()` with
 * an implicit server time-zone. Every conversion is explicit, driven
 * by the Harvest account's `time_zone` (an IANA id like
 * "America/New_York"). The server can run in any TZ; outputs are
 * identical.
 */

import type {
  HarvestClient,
  HarvestProject,
  HarvestTimeEntry,
  HarvestInvoice,
  HarvestInvoiceLineItem,
  HarvestUser,
} from "./harvest";
import { parseHarvestAddressForStorage } from "./harvest-address";
import { resolveTicketReference, ticketUrl } from "./tickets/detect";

// ────────────────────────────────────────────────────────────────
// Date range normalization
// ────────────────────────────────────────────────────────────────

/**
 * Validate and normalize a date-range filter for the Harvest time-
 * entries query. Harvest accepts `from` / `to` in YYYY-MM-DD and is
 * inclusive on both ends.
 *
 * Empty / whitespace values coerce to undefined. Non-YYYY-MM-DD
 * strings throw so we fail loudly rather than silently pulling the
 * full account (which is what the API does with an invalid filter).
 *
 * Returns undefined when neither bound is set — callers then skip
 * the params object entirely and Harvest returns all-time.
 */
export function normalizeDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
): { from?: string; to?: string } | undefined {
  const normalize = (v: string | null | undefined): string | undefined => {
    if (v == null) return undefined;
    const s = v.trim();
    if (s === "") return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new Error(`Date must be YYYY-MM-DD, got: ${v}`);
    }
    return s;
  };

  const fromN = normalize(from);
  const toN = normalize(to);

  if (!fromN && !toN) return undefined;

  if (fromN && toN && fromN > toN) {
    throw new Error(
      `Date range is inverted: from ${fromN} is after to ${toN}`,
    );
  }

  return {
    ...(fromN ? { from: fromN } : {}),
    ...(toN ? { to: toN } : {}),
  };
}

// ────────────────────────────────────────────────────────────────
// Time-zone resolution
// ────────────────────────────────────────────────────────────────

/**
 * Convert a wall-clock timestamp ("YYYY-MM-DD[THH:MM[:SS]]") that's
 * implicitly in the given IANA time zone to a UTC Date. Handles DST
 * correctly — a 2024-03-15 09:30 in "America/New_York" resolves to
 * 13:30 UTC (EDT), while 2024-01-15 09:30 resolves to 14:30 UTC (EST).
 *
 * Algorithm:
 *   1. Pretend the string is already UTC → get a provisional Date.
 *   2. Render that UTC instant in the target TZ to see what wall-clock
 *      time it corresponds to over there.
 *   3. The difference between the wall-clock we have and the wall-clock
 *      we got tells us the zone's offset at that instant.
 *   4. Subtract the offset to land on the real UTC Date.
 *
 * Works across DST transitions because step 2 always picks the offset
 * that was actually in effect at the zoned instant.
 */
export function zonedWallClockToUtc(
  isoLocal: string,
  timeZone: string,
): Date {
  // Normalize to "YYYY-MM-DDTHH:MM:SS" — callers might pass without
  // seconds or without the T separator.
  const normalized = isoLocal.includes("T")
    ? isoLocal
    : isoLocal.replace(" ", "T");
  const withSeconds = /T\d\d:\d\d$/.test(normalized)
    ? normalized + ":00"
    : normalized;

  // Step 1 — treat input as UTC.
  const asUtc = new Date(withSeconds + "Z");
  if (Number.isNaN(asUtc.getTime())) {
    throw new Error(`Invalid date string: ${isoLocal}`);
  }

  // Step 2 — render that UTC instant in the target zone.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(asUtc);

  const part = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`Missing ${type} in formatted parts`);
    return Number(p.value);
  };

  // Intl returns 24 for midnight on some engines; treat that as 0.
  const hour = part("hour") === 24 ? 0 : part("hour");
  const zonedWallMs = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    hour,
    part("minute"),
    part("second"),
  );

  // Step 3 — the delta tells us the zone's offset at this instant.
  const offsetMs = zonedWallMs - asUtc.getTime();

  // Step 4 — apply the offset.
  return new Date(asUtc.getTime() - offsetMs);
}

/**
 * Resolve a Harvest time-entry pair (`spent_date`, `started_time`,
 * `ended_time`, `hours`, `is_running`) to a UTC start/end pair in ISO
 * format, accounting for the account's time zone.
 *
 * Harvest returns `started_time` / `ended_time` as strings like "9:30am"
 * (legacy) or "09:30" (24h). We normalize to 24h, glue to the date,
 * convert via `zonedWallClockToUtc`. When Harvest doesn't return a
 * start (some accounts capture duration-only), we synthesize 09:00 in
 * the account zone as a reasonable default and compute end from hours.
 */
export function resolveTimeEntryUtcBounds(args: {
  spent_date: string;
  started_time: string | null;
  ended_time: string | null;
  hours: number;
  is_running: boolean;
  timeZone: string;
}): { startUtcIso: string; endUtcIso: string | null } {
  const startHm = normalizeTimeOfDay(args.started_time) ?? "09:00";
  const startLocal = `${args.spent_date}T${startHm}:00`;
  const startUtc = zonedWallClockToUtc(startLocal, args.timeZone);

  let endUtc: Date | null = null;
  if (args.ended_time) {
    const endHm = normalizeTimeOfDay(args.ended_time);
    if (endHm) {
      const endLocal = `${args.spent_date}T${endHm}:00`;
      endUtc = zonedWallClockToUtc(endLocal, args.timeZone);
    }
  }
  // No ended_time → derive end from hours. An imported entry must
  // NEVER produce a Shyre live timer (end_time = null). Two flavors:
  //   - hours > 0  → completed session of `hours` length. Covers both
  //                  duration-only Harvest accounts AND running timers
  //                  (Harvest tracks elapsed in `hours`, so a forgotten
  //                  timer becomes "Started Mar 8, 1:00 AM, 1h 43m"
  //                  not "running for 114 days").
  //   - hours == 0 → zero-minute completed entry (end = start). Covers
  //                  Harvest entries opened on a task with no time
  //                  recorded — visible in Harvest's UI as "0:00" with
  //                  the timer-icon. Importing as a live timer was the
  //                  bug that bit Marcus's first re-import on AE-569.
  if (!endUtc) {
    const ms = args.hours > 0 ? args.hours * 60 * 60 * 1000 : 0;
    endUtc = new Date(startUtc.getTime() + ms);
  }

  return {
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
  };
}

/**
 * Harvest returns times in one of two shapes:
 *   "9:30am"   — legacy 12h format
 *   "09:30"    — 24h format
 *
 * Normalize both to "HH:MM" (24h, zero-padded). Null if unparseable.
 */
export function normalizeTimeOfDay(v: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim().toLowerCase();

  // 24h already — "HH:MM" or "H:MM"
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (m24) {
    const h = Number(m24[1]);
    const m = Number(m24[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // 12h — "9:30am" / "12:00pm"
  const m12 = /^(\d{1,2}):(\d{2})\s*(am|pm)$/.exec(trimmed);
  if (m12) {
    let h = Number(m12[1]);
    const m = Number(m12[2]);
    const ampm = m12[3];
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// User mapping
// ────────────────────────────────────────────────────────────────

/**
 * Per Harvest user, what should the importer do with their entries?
 *
 *   shyre user id → attribute to that user (must be a team_member of
 *                   the target team).
 *   "importer"    → fall back to the importing user.
 *   "skip"        → drop these entries.
 *   "shell"       → create a non-loggable auth user to anchor these
 *                   entries (preserves authorship for ex-collaborators
 *                   who won't sign in). The route materializes the
 *                   shell account up front and rewrites the mapping
 *                   entry to the new user_id BEFORE resolveEntryUserId
 *                   runs — so this branch is a request, not a runtime
 *                   value the resolver ever sees.
 */
export type UserMapChoice = string | "importer" | "skip" | "shell";

export interface UniqueHarvestUser {
  id: number;
  name: string;
  entryCount: number;
}

/** Return a de-duplicated list of Harvest users referenced by the
 * given time entries, with a count so the UI can show volume. Used on
 * the preview step to build the mapping table. */
export function collectUniqueHarvestUsers(
  entries: Pick<HarvestTimeEntry, "user">[],
): UniqueHarvestUser[] {
  const byId = new Map<number, UniqueHarvestUser>();
  for (const e of entries) {
    const existing = byId.get(e.user.id);
    if (existing) {
      existing.entryCount++;
    } else {
      byId.set(e.user.id, {
        id: e.user.id,
        name: e.user.name,
        entryCount: 1,
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.entryCount - a.entryCount || a.name.localeCompare(b.name),
  );
}

/** Propose a default mapping: try to match Harvest users to Shyre team
 * members by email (strict) or display name (case-insensitive). If no
 * Shyre member matches, fall back to checking unlinked business_people
 * — when a Harvest user matches a person record (by work_email or
 * legal_name / preferred_name), default the mapping to `bp:<personId>`
 * so the import preserves the user's "I added them under Business →
 * People" intent without creating an orphan shell account.
 *
 * Anything that doesn't match either pool defaults to "importer". The
 * UI can override.
 */
export function proposeDefaultUserMapping(
  harvestUsers: HarvestUser[],
  shyreMembers: ReadonlyArray<{
    user_id: string;
    email: string | null;
    display_name: string | null;
  }>,
  businessPeople: ReadonlyArray<{
    id: string;
    legal_name: string;
    preferred_name: string | null;
    work_email: string | null;
  }> = [],
): Record<number, UserMapChoice> {
  const memberByEmail = new Map<string, string>();
  const memberByName = new Map<string, string>();
  for (const m of shyreMembers) {
    if (m.email) memberByEmail.set(m.email.toLowerCase(), m.user_id);
    if (m.display_name) memberByName.set(m.display_name.toLowerCase(), m.user_id);
  }
  const personByEmail = new Map<string, string>();
  const personByName = new Map<string, string>();
  for (const p of businessPeople) {
    if (p.work_email) personByEmail.set(p.work_email.toLowerCase(), p.id);
    if (p.legal_name) personByName.set(p.legal_name.toLowerCase(), p.id);
    if (p.preferred_name) personByName.set(p.preferred_name.toLowerCase(), p.id);
  }

  const out: Record<number, UserMapChoice> = {};
  for (const h of harvestUsers) {
    const email = h.email?.toLowerCase();
    const fullName = `${h.first_name} ${h.last_name}`.trim().toLowerCase();

    if (email && memberByEmail.has(email)) {
      out[h.id] = memberByEmail.get(email)!;
    } else if (memberByName.has(fullName)) {
      out[h.id] = memberByName.get(fullName)!;
    } else if (email && personByEmail.has(email)) {
      out[h.id] = `bp:${personByEmail.get(email)!}`;
    } else if (personByName.has(fullName)) {
      out[h.id] = `bp:${personByName.get(fullName)!}`;
    } else {
      out[h.id] = "importer";
    }
  }
  return out;
}

/** Resolve a Harvest user ID to the target Shyre user id (or skip).
 *
 *  By the time this runs, the route layer must have already
 *  materialized any "shell" requests into real auth user ids and
 *  rewritten the mapping in place — encountering "shell" here is a
 *  programmer error, not a user-facing failure mode, so we throw
 *  rather than silently skipping. */
export function resolveEntryUserId(
  harvestUserId: number,
  mapping: Record<number, UserMapChoice>,
  importerUserId: string,
): string | null {
  const choice = mapping[harvestUserId] ?? "importer";
  if (choice === "skip") return null;
  if (choice === "importer") return importerUserId;
  if (choice === "shell") {
    throw new Error(
      `Unmaterialized "shell" mapping for Harvest user ${harvestUserId}. ` +
        "The import route must create shell accounts before time-entry mapping.",
    );
  }
  if (typeof choice === "string" && choice.startsWith("bp:")) {
    throw new Error(
      `Unmaterialized "bp:" mapping for Harvest user ${harvestUserId}. ` +
        "The import route must materialize business-person links before time-entry mapping.",
    );
  }
  return choice;
}

// ────────────────────────────────────────────────────────────────
// Task → category mapping
// ────────────────────────────────────────────────────────────────

export const HARVEST_CATEGORY_SET_NAME = "Harvest Tasks";

/** Extract the de-duplicated list of Harvest task names referenced by
 * the given entries. The importer creates one category per task name
 * under a single team-level "Harvest Tasks" set. */
export function collectUniqueTaskNames(
  entries: Pick<HarvestTimeEntry, "task">[],
): string[] {
  const names = new Set<string>();
  for (const e of entries) {
    const n = e.task.name.trim();
    if (n.length > 0) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ────────────────────────────────────────────────────────────────
// Row builders
// ────────────────────────────────────────────────────────────────

export interface ImportContext {
  /** Target Shyre team to land the data in. */
  teamId: string;
  /** The user triggering the import; default user_id for rows whose
   * Harvest user isn't mapped explicitly. */
  importerUserId: string;
  /** UUID generated per run; stamped on every row for bulk undo. */
  importRunId: string;
  /** ISO timestamp when the run started; stamped on every row. */
  importedAt: string;
}

export function buildCustomerRow(
  hc: HarvestClient,
  ctx: ImportContext,
): {
  team_id: string;
  user_id: string;
  name: string;
  address: string | null;
  imported_from: string;
  imported_at: string;
  import_run_id: string;
  import_source_id: string;
} {
  // Harvest stores client addresses as a single multi-line string
  // (its UI is a freeform textarea). Shyre's address column is a
  // structured JSON blob (street / street2 / city / state /
  // postalCode / country). Without parsing we'd fall through to
  // deserializeAddress's plain-text fallback — every byte landing
  // in `street`, line breaks collapsed in the input, city/state/zip
  // empty. That's exactly what bookkeeper-flagged after the first
  // import. parseHarvestAddressForStorage converts to the
  // structured shape so the customer detail form renders fields
  // populated and the invoice From/To blocks line-break correctly.
  return {
    team_id: ctx.teamId,
    user_id: ctx.importerUserId,
    name: hc.name,
    address: parseHarvestAddressForStorage(hc.address),
    imported_from: "harvest",
    imported_at: ctx.importedAt,
    import_run_id: ctx.importRunId,
    import_source_id: String(hc.id),
  };
}

export function buildProjectRow(
  hp: HarvestProject,
  customerId: string | null,
  ctx: ImportContext,
  /**
   * Optional. When set, the project is created with this as its base
   * category set — required so the validate_time_entry_category
   * trigger accepts time entries tagged with categories from the
   * "Harvest Tasks" set. Null or omitted → project has no base set,
   * which is fine for projects where time entries won't carry a
   * category_id.
   */
  categorySetId: string | null = null,
): {
  team_id: string;
  user_id: string;
  customer_id: string | null;
  name: string;
  description: string | null;
  hourly_rate: number | null;
  budget_hours: number | null;
  status: "active" | "paused" | "archived";
  category_set_id: string | null;
  imported_from: string;
  imported_at: string;
  import_run_id: string;
  import_source_id: string;
} {
  return {
    team_id: ctx.teamId,
    user_id: ctx.importerUserId,
    customer_id: customerId,
    name: hp.name,
    description: hp.notes,
    hourly_rate: hp.hourly_rate,
    budget_hours: hp.budget,
    // Harvest `is_active=false` projects get imported as archived (not
    // skipped) so historical time entries still have a project to point
    // at. Active stays active; anything else is archived.
    status: hp.is_active ? "active" : "archived",
    category_set_id: categorySetId,
    imported_from: "harvest",
    imported_at: ctx.importedAt,
    import_run_id: ctx.importRunId,
    import_source_id: String(hp.id),
  };
}

/** Map a Harvest invoice state to a Shyre invoice status. The user's
 *  Harvest accounts are 99% paid / not-paid in practice, but we still
 *  pick reasonable values for the rare draft / closed / written-off
 *  cases so the import doesn't drop them or land them in a misleading
 *  bucket.
 *
 *    paid                   → paid    (settled)
 *    draft                  → draft   (in-progress, not sent)
 *    closed | written-off   → void    (no money expected)
 *    open | anything else   → sent    (issued, awaiting payment)
 */
export function mapHarvestInvoiceState(
  state: string,
): "draft" | "sent" | "paid" | "void" {
  const normalized = state?.toLowerCase().trim();
  if (normalized === "paid") return "paid";
  if (normalized === "draft") return "draft";
  if (normalized === "closed" || normalized === "written-off") return "void";
  return "sent";
}

export function buildInvoiceRow(
  hi: HarvestInvoice,
  customerId: string | null,
  ctx: ImportContext,
): {
  team_id: string;
  user_id: string;
  customer_id: string | null;
  invoice_number: string;
  status: "draft" | "sent" | "paid" | "void";
  issued_date: string | null;
  due_date: string | null;
  /** Preserve Harvest's actual sent timestamp. The DB INSERT trigger
   *  (`tg_invoices_status_timestamps_insert`) only stamps `now()` when
   *  the value is NULL, so passing through Harvest's value sticks. */
  sent_at: string | null;
  /** Same as sent_at — Harvest's actual paid timestamp wins over the
   *  INSERT trigger's `now()` fallback. */
  paid_at: string | null;
  subtotal: number;
  discount_amount: number;
  discount_rate: number | null;
  discount_reason: string | null;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  imported_from: string;
  imported_at: string;
  import_run_id: string;
  import_source_id: string;
} {
  // Harvest reports `amount` as the invoice total (incl. tax) and
  // `tax_amount` as the tax portion. Subtotal is computed by adding
  // back the discount (which Harvest already deducted from `amount`)
  // and removing tax. tax_rate is stored as a percentage (e.g. 8.25
  // for 8.25%); Harvest's `tax` field is already in that shape, so
  // we pass it through unchanged.
  //
  // Discount is the recovered piece — without it, a 100%-discount
  // Harvest invoice imports as $0 across all four columns. With it,
  // we get $290.40 subtotal / $290.40 discount / $0 total — the real
  // shape an auditor needs to see.
  const total = hi.amount ?? 0;
  const taxAmount = hi.tax_amount ?? 0;
  const discountAmount = hi.discount_amount ?? 0;
  const discountRate = hi.discount ?? null;
  // subtotal = total + discount - tax (un-deduct the discount Harvest
  // baked in, then strip the tax that's also baked in).
  const subtotal = total + discountAmount - taxAmount;
  const taxRate = hi.tax ?? 0;

  // Harvest splits subject and notes; collapse them into Shyre's
  // single notes column. Subject first (it's the headline), then a
  // blank line, then the body if any.
  const notes =
    hi.subject && hi.notes
      ? `${hi.subject}\n\n${hi.notes}`
      : (hi.subject ?? hi.notes);

  return {
    team_id: ctx.teamId,
    user_id: ctx.importerUserId,
    customer_id: customerId,
    invoice_number: hi.number,
    status: mapHarvestInvoiceState(hi.state),
    issued_date: hi.issue_date,
    due_date: hi.due_date,
    // Harvest exposes both `paid_at` (timestamp) and `paid_date` (date
    // only). Prefer the timestamp when present so the activity log
    // shows the actual time of day; fall back to the date string,
    // which Postgres stores fine in a TIMESTAMPTZ column.
    sent_at: hi.sent_at,
    paid_at: hi.paid_at ?? hi.paid_date,
    subtotal,
    discount_amount: discountAmount,
    discount_rate: discountRate,
    // Auto-tag imported discounts so a bookkeeper auditing the
    // discount column can tell apart "user-applied" vs
    // "imported, original reason unknown."
    discount_reason: discountAmount > 0 ? "imported_from_harvest" : null,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
    notes,
    imported_from: "harvest",
    imported_at: ctx.importedAt,
    import_run_id: ctx.importRunId,
    import_source_id: String(hi.id),
  };
}

/**
 * Pull the most-recent send recipient out of a list of Harvest invoice
 * messages. Returns the first email + display-name pair we can find
 * on the latest "send"-style message (event_type either null — the
 * default send — or "send" / "reminder"; "view" and "thank_you" are
 * server-generated and don't carry a meaningful recipient for our log).
 *
 * Returning null when no messages match is fine: the caller writes
 * nothing to invoices.sent_to_*, leaving the column NULL.
 */
export function pickLatestSendRecipient(
  messages: import("./harvest").HarvestInvoiceMessage[],
): { email: string; name: string | null } | null {
  const sends = messages.filter(
    (m) =>
      m.event_type === null ||
      m.event_type === "send" ||
      m.event_type === "reminder",
  );
  // Sort newest-first by created_at.
  const sorted = [...sends].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const msg of sorted) {
    const r = msg.recipients?.[0];
    if (r?.email) {
      return { email: r.email, name: r.name ?? null };
    }
  }
  return null;
}

/**
 * Build an `invoice_payments` row from a Harvest payment record.
 *
 * Harvest's invoice payload only has the date a user clicked "Mark
 * paid" (often midnight UTC), so the activity log was rendering all
 * imports as "Marked as paid at 12:00 AM". Real payment data lives at
 * /v2/invoices/{id}/payments — each row carries the actual paid_at
 * timestamp, the amount, and who recorded it. Importing those gives
 * the activity log accurate "Payment received" events with the right
 * dollar amount.
 *
 * `team_id` is intentionally omitted — the DB BEFORE-INSERT trigger
 * (`tg_invoice_payments_set_team`) populates it from the parent
 * invoice so callers can't pass a wrong team_id. Same pattern Shyre
 * uses for cascade-style fields elsewhere.
 */
export function buildInvoicePaymentRow(
  payment: import("./harvest").HarvestInvoicePayment,
  shyreInvoiceId: string,
  invoiceCurrency: string | null,
): {
  invoice_id: string;
  amount: number;
  currency: string;
  paid_on: string;
  paid_at: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
} {
  // paid_on is the calendar date — required NOT NULL in our schema,
  // and the bookkeeper's grain (matches bank statements). Harvest
  // reliably populates paid_date; if not, derive from paid_at, then
  // from created_at as a last resort.
  const paidOn =
    payment.paid_date ??
    (payment.paid_at ? payment.paid_at.slice(0, 10) : null) ??
    payment.created_at.slice(0, 10);

  // paid_at = the wall-clock time the action happened, NOT Harvest's
  // own paid_at field. Harvest's paid_at is the user-entered paid
  // date stored as midnight UTC for manual payments — converting to
  // local time then "moves" the event to the previous day in
  // negative-offset zones. Harvest's own activity log (e.g. "Marcus
  // on 04/24/2026 at 9:26am") uses created_at, which is the precise
  // moment the user clicked Save. We follow the same convention so
  // imported events line up with what the user sees in Harvest.
  const paidAt = payment.created_at;

  // Method = Harvest's payment_gateway name when present (e.g.
  // "Stripe", "PayPal"), else "Manual" for anything recorded by hand.
  const method = payment.payment_gateway?.name ?? "Manual";

  // Reference: prefer the gateway transaction id (canonical), fall
  // back to nothing.
  const reference = payment.transaction_id;

  return {
    invoice_id: shyreInvoiceId,
    amount: payment.amount,
    currency: (invoiceCurrency ?? "USD").toUpperCase(),
    paid_on: paidOn,
    paid_at: paidAt,
    method,
    reference,
    notes: payment.notes,
  };
}

/** Build an invoice_line_items row from a Harvest line item. Caller
 *  supplies the parent Shyre invoice id; we don't currently link
 *  individual line items back to time_entries (Harvest's payload
 *  doesn't expose that mapping inline) — time entries get marked as
 *  invoiced via their own `invoice` field on the time-entry pass. */
export function buildInvoiceLineItemRow(
  li: HarvestInvoiceLineItem,
  invoiceId: string,
): {
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
} {
  // Description is required NOT NULL in Shyre. Harvest sometimes ships
  // a null description on auto-generated lines (relies on `kind` to
  // describe the item) — fall back to kind, then to a generic label.
  const description =
    li.description?.trim() ||
    (li.kind ? li.kind : "Line item");
  return {
    invoice_id: invoiceId,
    description,
    quantity: li.quantity ?? 0,
    unit_price: li.unit_price ?? 0,
    amount: li.amount ?? 0,
  };
}

/**
 * Build a time_entries row from a Harvest entry. Returns `null` when
 * the entry should be skipped:
 *   - project was skipped on the parent pass (no projectId mapping)
 *   - user was mapped to "skip"
 *   - start time couldn't be resolved
 *
 * Detects Jira/GitHub ticket references in the description and
 * populates the `linked_ticket_*` columns synchronously. The lookup
 * (Jira/GitHub API) is deliberately NOT performed here — 177 imports
 * would mean 177 outbound calls and likely rate-limits. The chip
 * renders with the key visible; the user can click refresh on any
 * row to populate the resolved title.
 */
/**
 * Extract the human-readable Jira key (e.g. "AE-638") from a Jira
 * issue permalink. Jira Cloud URLs always include the key in the
 * `/browse/{KEY}` segment regardless of internal id; on-prem
 * variants follow the same pattern. Returns null when the permalink
 * doesn't match — caller falls back to whatever Harvest gave us as
 * the id.
 *
 * Why this exists: Harvest's external_reference.id for a Jira
 * attachment is the *numeric internal issue id* (e.g. "12702"), not
 * the human key the user knows. The permalink does carry the human
 * key, so we parse it out for display.
 */
export function extractJiraKeyFromPermalink(
  permalink: string | null,
): string | null {
  if (!permalink) return null;
  // Match "/browse/<KEY>" where KEY is project + dash + digits;
  // tolerate trailing slash or query string.
  const match = permalink.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)\b/);
  return match?.[1] ?? null;
}

/**
 * Decide what provider to attribute Harvest's external_reference
 * to. Three signals, in priority order:
 *
 *   1. `service` says "jira" or "github" (case-insensitive,
 *      substring match — Harvest uses bare slugs but a future API
 *      change could prefix them, e.g. "atlassian-jira").
 *   2. `permalink` host hints — atlassian.net, jira.com,
 *      github.com — used when service is null but the URL is
 *      clearly one of ours.
 *   3. ID format heuristic — "ABC-123" is unambiguously a Jira
 *      key; "owner/repo#NN" is GitHub. Used when both service
 *      and permalink are unhelpful.
 *
 * Returns null when the reference points at something we don't
 * surface yet (Trello, Asana, etc.) — the caller falls back to
 * description-based parsing.
 *
 * Exported so tests can pin the heuristic without rebuilding the
 * full HarvestTimeEntry shape.
 */
export function pickExternalProvider(
  externalRef: HarvestTimeEntry["external_reference"],
): "jira" | "github" | null {
  if (!externalRef || !externalRef.id) return null;

  const service = externalRef.service?.toLowerCase() ?? "";
  if (service.includes("jira")) return "jira";
  if (service.includes("github")) return "github";

  const permalink = externalRef.permalink?.toLowerCase() ?? "";
  if (permalink.includes("atlassian.net") || permalink.includes("jira.")) {
    return "jira";
  }
  if (permalink.includes("github.com")) return "github";

  // ID-shape fallback. Jira keys are uppercase project + dash + digits
  // (e.g. AE-638, PROJ-1, NUMBERS_PROJ-99). GitHub keys are
  // owner/repo#NN or just #NN. Be conservative: only attribute when
  // the shape is unambiguous so we don't mis-attribute Trello-style
  // ids that happen to contain digits.
  const id = externalRef.id;
  if (/^[A-Z][A-Z0-9_]*-\d+$/.test(id)) return "jira";
  if (/^[\w.-]+\/[\w.-]+#\d+$/.test(id)) return "github";

  return null;
}

export function buildTimeEntryRow(args: {
  entry: HarvestTimeEntry;
  projectId: string | null;
  projectHourlyRate: number | null;
  /** Project's `github_repo` (e.g. "octokit/rest.js"). Lets a bare
   *  `#123` in a Harvest note resolve to the project's repo. */
  projectGithubRepo?: string | null;
  /** Project's `jira_project_key` (e.g. "PROJ"). Reserved for
   *  symmetry; today's resolver doesn't use it for short refs. */
  projectJiraProjectKey?: string | null;
  userMapping: Record<number, UserMapChoice>;
  categoryIdByTaskName: Map<string, string>;
  ctx: ImportContext;
  timeZone: string;
  /** Harvest invoice.id → Shyre invoice id, populated by the invoice
   *  pass on the route. Optional so existing callers / tests don't
   *  need to know about invoices. When the entry's `invoice` field
   *  resolves through this map, the row is stamped invoiced=true with
   *  the matching invoice_id. */
  invoiceMap?: Map<number, string>;
}):
  | {
      team_id: string;
      user_id: string;
      project_id: string;
      category_id: string | null;
      description: string | null;
      start_time: string;
      end_time: string | null;
      billable: boolean;
      invoiced: boolean;
      invoice_id: string | null;
      linked_ticket_provider: "jira" | "github" | null;
      linked_ticket_key: string | null;
      linked_ticket_url: string | null;
      linked_ticket_title: string | null;
      linked_ticket_refreshed_at: string | null;
      imported_from: string;
      imported_at: string;
      import_run_id: string;
      import_source_id: string;
    }
  | { skipped: true; reason: string } {
  if (args.projectId === null) {
    return { skipped: true, reason: "no matching project" };
  }

  const targetUserId = resolveEntryUserId(
    args.entry.user.id,
    args.userMapping,
    args.ctx.importerUserId,
  );
  if (targetUserId === null) {
    return { skipped: true, reason: "user mapped to skip" };
  }

  let bounds: { startUtcIso: string; endUtcIso: string | null };
  try {
    bounds = resolveTimeEntryUtcBounds({
      spent_date: args.entry.spent_date,
      started_time: args.entry.started_time,
      ended_time: args.entry.ended_time,
      hours: args.entry.hours,
      is_running: args.entry.is_running,
      timeZone: args.timeZone,
    });
  } catch (err) {
    return {
      skipped: true,
      reason: `invalid time: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const description = buildEntryDescription({
    notes: args.entry.notes,
    taskName: args.entry.task.name,
    billableRate: args.entry.billable_rate,
    projectHourlyRate: args.projectHourlyRate,
  });

  const categoryId =
    args.categoryIdByTaskName.get(args.entry.task.name.trim()) ?? null;

  // If Harvest marked this entry as invoiced AND the invoice landed in
  // Shyre on the same run, link them. Skipped invoices (e.g. a draft
  // that fell outside the date window) leave the entry "billable but
  // not yet invoiced" — the safer default.
  const harvestInvoiceId = args.entry.invoice?.id;
  const linkedInvoiceId =
    harvestInvoiceId !== undefined
      ? (args.invoiceMap?.get(harvestInvoiceId) ?? null)
      : null;

  // Ticket detection. Harvest's `external_reference` is the
  // authoritative link when a user attached one via Harvest's
  // integrations (Jira / GitHub / etc.) — it's set even when the
  // description doesn't mention the issue key, which is the case
  // text-parsing miss that prompted this code path. Fall back to
  // resolveTicketReference (description-based heuristic) when
  // external_reference is absent or the service isn't one we
  // currently surface.
  //
  // Sync detection only — the title lookup against the source
  // system happens later via the chip's refresh path. 177 imports
  // × 1 outbound API call would rate-limit Jira/GitHub immediately.
  const externalRef = args.entry.external_reference;
  const externalProvider = pickExternalProvider(externalRef);
  // For Jira attachments, prefer the human key parsed from the
  // permalink ("AE-638") over Harvest's external_reference.id, which
  // is the numeric internal issue id ("12702") — meaningless to the
  // user. GitHub references already arrive in human form
  // (owner/repo#NN), so we keep their id as-is.
  const externalKey = externalProvider
    ? externalProvider === "jira"
      ? (extractJiraKeyFromPermalink(externalRef?.permalink ?? null) ??
        externalRef!.id)
      : externalRef!.id
    : null;
  const ticket = externalProvider && externalKey
    ? {
        provider: externalProvider as "jira" | "github",
        key: externalKey,
      }
    : description
      ? resolveTicketReference(description, {
          defaultGithubRepo: args.projectGithubRepo ?? null,
          defaultJiraProjectKey: args.projectJiraProjectKey ?? null,
        })
      : null;
  // URL: prefer Harvest's permalink (canonical), fall back to the
  // synthesized GitHub URL when we only have a key. Jira URLs that
  // come from text-parsing stay null and get filled in later by the
  // chip refresh path that reads the user's jira_base_url.
  const ticketUrlValue =
    externalProvider && externalRef?.permalink
      ? externalRef.permalink
      : ticket?.provider === "github"
        ? ticketUrl({ provider: "github", key: ticket.key })
        : null;

  return {
    team_id: args.ctx.teamId,
    user_id: targetUserId,
    project_id: args.projectId,
    category_id: categoryId,
    description,
    start_time: bounds.startUtcIso,
    end_time: bounds.endUtcIso,
    billable: args.entry.billable,
    invoiced: linkedInvoiceId !== null,
    invoice_id: linkedInvoiceId,
    linked_ticket_provider: ticket?.provider ?? null,
    linked_ticket_key: ticket?.key ?? null,
    // GitHub URLs resolve from key alone; Jira URLs need the user's
    // jira_base_url which lives on user_settings — leave null and let
    // the chip's refresh path fill it in.
    linked_ticket_url: ticketUrlValue,
    linked_ticket_title: null,
    linked_ticket_refreshed_at: null,
    imported_from: "harvest",
    imported_at: args.ctx.importedAt,
    import_run_id: args.ctx.importRunId,
    import_source_id: String(args.entry.id),
  };
}

// ────────────────────────────────────────────────────────────────
// Reconciliation — did the import actually land what Harvest said
// was there?
// ────────────────────────────────────────────────────────────────

export interface ReconciliationPerCustomer {
  name: string;
  harvestHours: number;
  shyreHours: number;
  harvestEntries: number;
  shyreEntries: number;
  match: boolean;
}

export interface ReconciliationReport {
  /** Totals across all fetched Harvest entries in the import window. */
  harvest: { entries: number; hours: number };
  /** Totals across Shyre time_entries whose import_source_id matches
   * one of the Harvest entries in the window — either inserted this
   * run, or already-existing from a prior run with the same source id. */
  shyre: { entries: number; hours: number };
  /** Entries Harvest fetched that we cannot find in Shyre. Populated
   * only when match === false; each row includes the reason if the
   * import had one (skipped for no project, etc.). */
  missing: {
    count: number;
    hours: number;
    reasonsByCount: Record<string, number>;
  };
  /** True iff harvest.entries === shyre.entries AND hours are within
   * a small epsilon (see HOURS_EPSILON). */
  match: boolean;
  /** Grouped by Harvest client name — useful for spot-checking which
   * customer is under-counted when the top-line numbers disagree. */
  perCustomer: ReconciliationPerCustomer[];
}

/**
 * Reconciliation tolerance for "Harvest hours match Shyre hours."
 *
 * Pre-fix-B (before 2026-05-04 commit): the report compared
 * Harvest's 2-decimal `hours` field directly to Shyre's
 * `duration_min / 60`. Different storage granularities (0.01h
 * vs 1 min) produced cumulative rounding drift on every import —
 * a 21-entry test run flagged a 0.09h "mismatch" that was pure
 * noise.
 *
 * Post-fix-B: the report computes the Harvest column at the SAME
 * minute granularity Shyre stores. Each Harvest entry's expected
 * duration_min = round(harvest.hours × 60), summed and divided by
 * 60. That mirrors what the importer + the DB's
 * STORED-generated `duration_min` column produce, so the two
 * sides become apples-to-apples.
 *
 * In practice the residual drift is sub-millihour float-residue
 * noise. The epsilon stays at 0.01h as a safety net for the
 * float-residue case + any edge entries (running timers, missing
 * timestamps) where the importer's bound-derivation lands a
 * minute off from the round formula. A real-world mismatch
 * (missing entry, wrong-project attribution) blows past 0.01h
 * easily, so the epsilon doesn't hide signal. */
const HOURS_EPSILON = 0.01;

/**
 * Convert a Harvest entry's `hours` field to the Shyre-grain
 * minute count the importer + DB end up storing. Used on both
 * sides of the reconciliation comparison so any drift is real
 * data drift, not rounding-method drift between two systems.
 *
 * Why round and not truncate: Postgres' STORED-generated
 * `duration_min INTEGER GENERATED ALWAYS AS (EXTRACT(EPOCH FROM
 * (end - start)) / 60)` casts the numeric result to INTEGER,
 * which by SQL spec rounds half-to-even. JS `Math.round` is
 * half-up. The two agree on every value except .5-boundaries,
 * which on real Harvest data (entries logged in seconds /
 * minutes, hours field rounded to 0.01) almost never land
 * exactly. Half-up is the safer default — drift only occurs on
 * the rarest entries, and either rounding produces the right
 * total over a window.
 */
function harvestHoursToShyreMin(hours: number): number {
  return Math.round(hours * 60);
}

/**
 * Build a side-by-side reconciliation report comparing what Harvest
 * returned for a given fetch window with what Shyre has after the
 * import. The Shyre side is passed in (fetched by the caller from
 * the DB) rather than computed here because this module stays pure —
 * no database access.
 *
 * Shape of the inputs:
 *   harvestEntries — the exact array returned by fetchHarvestTimeEntries
 *                    for the import window.
 *   shyreRows      — time_entries rows in the target team where
 *                    import_source_id ∈ the set of Harvest entry IDs.
 *                    Fields needed: import_source_id, duration_min.
 *   skipReasons    — map of {reason → count} from the import pass
 *                    (the importer already tracks this).
 */
export function buildReconciliation(args: {
  harvestEntries: ReadonlyArray<{
    id: number;
    hours: number;
    client: { id: number; name: string };
  }>;
  shyreRows: ReadonlyArray<{
    import_source_id: string;
    duration_min: number | null;
  }>;
  skipReasons: Record<string, number>;
}): ReconciliationReport {
  const shyreBySourceId = new Map<string, number>(); // source_id → duration_min
  for (const row of args.shyreRows) {
    shyreBySourceId.set(
      row.import_source_id,
      row.duration_min ?? 0,
    );
  }

  // Top-line totals.
  //
  // Harvest column uses the SAME grain Shyre stores at: convert
  // each entry's hours to the integer-minute count the importer
  // + DB land on, sum, then divide by 60 for display. Without
  // this, comparing 2-decimal hours against integer minutes
  // produces sub-percent rounding drift on every import that
  // looks like a real mismatch but isn't.
  const harvestEntries = args.harvestEntries.length;
  const harvestHours =
    args.harvestEntries.reduce(
      (a, e) => a + harvestHoursToShyreMin(e.hours),
      0,
    ) / 60;
  const shyreEntries = shyreBySourceId.size;
  const shyreHours = [...shyreBySourceId.values()].reduce(
    (a, min) => a + min / 60,
    0,
  );

  // Per-customer breakdown. Group by Harvest client name on both
  // sides so the user sees one row per customer that ever appeared
  // in the fetch — a zero on the Shyre side is the tell-tale
  // "this customer's entries didn't land."
  interface Bucket {
    harvestHours: number;
    harvestEntries: number;
    shyreHours: number;
    shyreEntries: number;
  }
  const byCustomer = new Map<string, Bucket>();
  const ensure = (name: string): Bucket => {
    let b = byCustomer.get(name);
    if (!b) {
      b = { harvestHours: 0, harvestEntries: 0, shyreHours: 0, shyreEntries: 0 };
      byCustomer.set(name, b);
    }
    return b;
  };

  // Missing entries: Harvest fetched → not in Shyre. We also build a
  // reason breakdown as we go when the importer reported one.
  let missingCount = 0;
  let missingHours = 0;

  for (const e of args.harvestEntries) {
    const bucket = ensure(e.client.name);
    // Same grain conversion as the top-line totals. Every entry's
    // expected hours = (round(hours × 60)) / 60 so the Harvest
    // column compares apples-to-apples against Shyre's storage.
    const expectedMin = harvestHoursToShyreMin(e.hours);
    bucket.harvestHours += expectedMin / 60;
    bucket.harvestEntries += 1;

    const shyreMin = shyreBySourceId.get(String(e.id));
    if (shyreMin !== undefined) {
      bucket.shyreHours += shyreMin / 60;
      bucket.shyreEntries += 1;
    } else {
      missingCount += 1;
      missingHours += expectedMin / 60;
    }
  }

  const perCustomer: ReconciliationPerCustomer[] = [...byCustomer.entries()]
    .map(([name, b]) => {
      const harvestRounded = roundHours(b.harvestHours);
      const shyreRounded = roundHours(b.shyreHours);
      return {
        name,
        harvestHours: harvestRounded,
        shyreHours: shyreRounded,
        harvestEntries: b.harvestEntries,
        shyreEntries: b.shyreEntries,
        // Match on the rounded (what-the-user-sees) values with `<=`
        // so a 0.01h display diff is consistently a match. Comparing
        // unrounded values produced cosmetic contradictions where two
        // identical-looking rows disagreed on the icon.
        match:
          b.harvestEntries === b.shyreEntries &&
          Math.abs(harvestRounded - shyreRounded) <= HOURS_EPSILON,
      };
    })
    .sort(
      (a, b) =>
        b.harvestHours - a.harvestHours || a.name.localeCompare(b.name),
    );

  const harvestHoursRounded = roundHours(harvestHours);
  const shyreHoursRounded = roundHours(shyreHours);
  const match =
    harvestEntries === shyreEntries &&
    Math.abs(harvestHoursRounded - shyreHoursRounded) <= HOURS_EPSILON;

  return {
    harvest: {
      entries: harvestEntries,
      hours: roundHours(harvestHours),
    },
    shyre: {
      entries: shyreEntries,
      hours: roundHours(shyreHours),
    },
    missing: {
      count: missingCount,
      hours: roundHours(missingHours),
      reasonsByCount: args.skipReasons,
    },
    match,
    perCustomer,
  };
}

function roundHours(h: number): number {
  // Match Harvest's 2-decimal precision so tiny float residue doesn't
  // show up as "120.00000003h".
  return Math.round(h * 100) / 100;
}

/**
 * Build the imported time entry's description.
 *
 * Description = user's Harvest notes verbatim, falling back to the
 * task name when notes are empty so a no-notes row still has a label.
 * No rate prefix, no task-name prefix, no decoration of any kind.
 *
 * Earlier this function decorated descriptions with "[$135/hr]
 * Programming: ..." to capture per-entry rate overrides + the
 * Harvest task. Both prefixes turned out to be noise:
 *   - taskName: Harvest's task → Shyre's category is preserved
 *     separately as a real category (under the "Harvest Tasks" set).
 *     Stamping it into the description was duplicate structured data.
 *   - rate prefix: meant to preserve per-entry billable_rate
 *     overrides. Iterations of "fire only when rate differs from
 *     project rate" kept failing — Harvest reports projects without a
 *     configured rate as either `null` OR `0`, and there's no clean
 *     way to distinguish "real $0 rate" from "no rate set" in the
 *     export. The audit-trail concern (recovering historical
 *     per-entry rates) is satisfied by `import_run_id` + the original
 *     Harvest data the user can re-fetch.
 *
 * If a per-entry rate snapshot ever needs to land in Shyre proper,
 * add a `time_entries.billable_rate_cents` column. Don't put it back
 * in the description.
 *
 * The `billableRate` and `projectHourlyRate` arguments are kept for
 * API compatibility (callers / tests pass them); both are unused.
 */
export function buildEntryDescription(args: {
  notes: string | null;
  taskName: string;
  billableRate: number | null;
  projectHourlyRate: number | null;
}): string {
  const notes = args.notes?.trim() ?? "";
  const taskName = args.taskName.trim();
  return notes || taskName;
}
