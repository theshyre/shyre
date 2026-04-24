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
  HarvestUser,
} from "./harvest";

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
  } else if (!args.is_running && args.hours > 0) {
    endUtc = new Date(startUtc.getTime() + args.hours * 60 * 60 * 1000);
  }

  return {
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc ? endUtc.toISOString() : null,
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
 */
export type UserMapChoice = string | "importer" | "skip";

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
 * members by email (strict) or display name (case-insensitive). Any
 * user that doesn't match defaults to "importer". The UI can override. */
export function proposeDefaultUserMapping(
  harvestUsers: HarvestUser[],
  shyreMembers: ReadonlyArray<{
    user_id: string;
    email: string | null;
    display_name: string | null;
  }>,
): Record<number, UserMapChoice> {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const m of shyreMembers) {
    if (m.email) byEmail.set(m.email.toLowerCase(), m.user_id);
    if (m.display_name) byName.set(m.display_name.toLowerCase(), m.user_id);
  }

  const out: Record<number, UserMapChoice> = {};
  for (const h of harvestUsers) {
    const email = h.email?.toLowerCase();
    const fullName = `${h.first_name} ${h.last_name}`.trim().toLowerCase();

    if (email && byEmail.has(email)) {
      out[h.id] = byEmail.get(email)!;
    } else if (byName.has(fullName)) {
      out[h.id] = byName.get(fullName)!;
    } else {
      out[h.id] = "importer";
    }
  }
  return out;
}

/** Resolve a Harvest user ID to the target Shyre user id (or skip). */
export function resolveEntryUserId(
  harvestUserId: number,
  mapping: Record<number, UserMapChoice>,
  importerUserId: string,
): string | null {
  const choice = mapping[harvestUserId] ?? "importer";
  if (choice === "skip") return null;
  if (choice === "importer") return importerUserId;
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
  return {
    team_id: ctx.teamId,
    user_id: ctx.importerUserId,
    name: hc.name,
    address: hc.address,
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

/**
 * Build a time_entries row from a Harvest entry. Returns `null` when
 * the entry should be skipped:
 *   - project was skipped on the parent pass (no projectId mapping)
 *   - user was mapped to "skip"
 *   - start time couldn't be resolved
 *
 * Includes the rate note when `billable_rate` differs from the project
 * rate — so the per-entry rate snapshot is preserved in the description
 * even though Shyre's time_entries table has no rate column.
 */
export function buildTimeEntryRow(args: {
  entry: HarvestTimeEntry;
  projectId: string | null;
  projectHourlyRate: number | null;
  userMapping: Record<number, UserMapChoice>;
  categoryIdByTaskName: Map<string, string>;
  ctx: ImportContext;
  timeZone: string;
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

  return {
    team_id: args.ctx.teamId,
    user_id: targetUserId,
    project_id: args.projectId,
    category_id: categoryId,
    description,
    start_time: bounds.startUtcIso,
    end_time: bounds.endUtcIso,
    billable: args.entry.billable,
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

/** Harvest reports hours to 2 decimal places; summing 1000 entries
 * can accumulate 1e-10 float error. Anything below this threshold is
 * treated as equal. */
const HOURS_EPSILON = 0.01;

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
  const harvestEntries = args.harvestEntries.length;
  const harvestHours = args.harvestEntries.reduce((a, e) => a + e.hours, 0);
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
    bucket.harvestHours += e.hours;
    bucket.harvestEntries += 1;

    const shyreMin = shyreBySourceId.get(String(e.id));
    if (shyreMin !== undefined) {
      bucket.shyreHours += shyreMin / 60;
      bucket.shyreEntries += 1;
    } else {
      missingCount += 1;
      missingHours += e.hours;
    }
  }

  const perCustomer: ReconciliationPerCustomer[] = [...byCustomer.entries()]
    .map(([name, b]) => ({
      name,
      harvestHours: roundHours(b.harvestHours),
      shyreHours: roundHours(b.shyreHours),
      harvestEntries: b.harvestEntries,
      shyreEntries: b.shyreEntries,
      match:
        b.harvestEntries === b.shyreEntries &&
        Math.abs(b.harvestHours - b.shyreHours) < HOURS_EPSILON,
    }))
    .sort(
      (a, b) =>
        b.harvestHours - a.harvestHours || a.name.localeCompare(b.name),
    );

  const match =
    harvestEntries === shyreEntries &&
    Math.abs(harvestHours - shyreHours) < HOURS_EPSILON;

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
 * Compose the entry description from notes + a rate-snapshot prefix
 * when Harvest's `billable_rate` differs from the project rate.
 *
 * Shyre's time_entries table has no per-entry rate column (rate is a
 * project attribute), so for historical imports with rate changes the
 * snapshot would otherwise be lost. Prefixing the description keeps
 * the information visible to the user while not adding a schema
 * column just for this case.
 *
 * No prefix when rate matches project rate or isn't set.
 */
export function buildEntryDescription(args: {
  notes: string | null;
  taskName: string;
  billableRate: number | null;
  projectHourlyRate: number | null;
}): string {
  const taskName = args.taskName.trim();
  const notes = args.notes?.trim() ?? "";
  const base = notes ? (taskName ? `${taskName}: ${notes}` : notes) : taskName;

  const rate = args.billableRate;
  const projectRate = args.projectHourlyRate;
  if (rate !== null && rate > 0 && rate !== projectRate) {
    return `[$${rate}/hr] ${base}`.trim();
  }
  return base;
}
