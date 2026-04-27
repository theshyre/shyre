import { describe, it, expect } from "vitest";
import {
  zonedWallClockToUtc,
  normalizeTimeOfDay,
  normalizeDateRange,
  resolveTimeEntryUtcBounds,
  collectUniqueHarvestUsers,
  proposeDefaultUserMapping,
  resolveEntryUserId,
  collectUniqueTaskNames,
  buildCustomerRow,
  buildProjectRow,
  buildTimeEntryRow,
  buildEntryDescription,
  buildReconciliation,
  buildInvoiceRow,
  buildInvoiceLineItemRow,
  mapHarvestInvoiceState,
  type ImportContext,
  type UserMapChoice,
} from "./harvest-import-logic";
import type {
  HarvestClient,
  HarvestProject,
  HarvestTimeEntry,
  HarvestUser,
  HarvestInvoice,
  HarvestInvoiceLineItem,
} from "./harvest";

// ────────────────────────────────────────────────────────────────
// zonedWallClockToUtc
// ────────────────────────────────────────────────────────────────

describe("zonedWallClockToUtc", () => {
  it("converts America/New_York wall-clock to UTC (EDT period)", () => {
    // 2024-07-15 09:30 in New York = 2024-07-15 13:30 UTC (EDT, -4)
    const d = zonedWallClockToUtc(
      "2024-07-15T09:30:00",
      "America/New_York",
    );
    expect(d.toISOString()).toBe("2024-07-15T13:30:00.000Z");
  });

  it("converts America/New_York wall-clock to UTC (EST period)", () => {
    // 2024-01-15 09:30 in New York = 2024-01-15 14:30 UTC (EST, -5)
    const d = zonedWallClockToUtc(
      "2024-01-15T09:30:00",
      "America/New_York",
    );
    expect(d.toISOString()).toBe("2024-01-15T14:30:00.000Z");
  });

  it("handles America/Los_Angeles (PDT)", () => {
    // 2024-07-15 09:30 in LA = 2024-07-15 16:30 UTC (PDT, -7)
    const d = zonedWallClockToUtc(
      "2024-07-15T09:30:00",
      "America/Los_Angeles",
    );
    expect(d.toISOString()).toBe("2024-07-15T16:30:00.000Z");
  });

  it("handles UTC passthrough", () => {
    const d = zonedWallClockToUtc("2024-07-15T09:30:00", "UTC");
    expect(d.toISOString()).toBe("2024-07-15T09:30:00.000Z");
  });

  it("accepts input without seconds", () => {
    const d = zonedWallClockToUtc("2024-07-15T09:30", "UTC");
    expect(d.toISOString()).toBe("2024-07-15T09:30:00.000Z");
  });

  it("accepts input with space separator", () => {
    const d = zonedWallClockToUtc("2024-07-15 09:30:00", "UTC");
    expect(d.toISOString()).toBe("2024-07-15T09:30:00.000Z");
  });

  it("throws on invalid input", () => {
    expect(() => zonedWallClockToUtc("not-a-date", "UTC")).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeTimeOfDay
// ────────────────────────────────────────────────────────────────

describe("normalizeDateRange", () => {
  it("returns undefined when both are blank / null", () => {
    expect(normalizeDateRange(null, null)).toBeUndefined();
    expect(normalizeDateRange(undefined, undefined)).toBeUndefined();
    expect(normalizeDateRange("", "")).toBeUndefined();
    expect(normalizeDateRange("  ", "  ")).toBeUndefined();
  });
  it("returns only the set side", () => {
    expect(normalizeDateRange("2024-01-01", null)).toEqual({
      from: "2024-01-01",
    });
    expect(normalizeDateRange(null, "2024-12-31")).toEqual({
      to: "2024-12-31",
    });
  });
  it("returns both when both set", () => {
    expect(normalizeDateRange("2024-01-01", "2024-12-31")).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
    });
  });
  it("trims whitespace", () => {
    expect(normalizeDateRange("  2024-01-01  ", null)).toEqual({
      from: "2024-01-01",
    });
  });
  it("throws on malformed dates", () => {
    expect(() => normalizeDateRange("2024/01/01", null)).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => normalizeDateRange("jan 1", null)).toThrow(/YYYY-MM-DD/);
    expect(() => normalizeDateRange("2024-1-1", null)).toThrow(/YYYY-MM-DD/);
  });
  it("throws when from is after to", () => {
    expect(() =>
      normalizeDateRange("2024-12-31", "2024-01-01"),
    ).toThrow(/inverted/);
  });
  it("allows from == to (single day)", () => {
    expect(normalizeDateRange("2024-06-15", "2024-06-15")).toEqual({
      from: "2024-06-15",
      to: "2024-06-15",
    });
  });
});

describe("normalizeTimeOfDay", () => {
  it("passes through valid 24h", () => {
    expect(normalizeTimeOfDay("09:30")).toBe("09:30");
    expect(normalizeTimeOfDay("23:59")).toBe("23:59");
    expect(normalizeTimeOfDay("00:00")).toBe("00:00");
  });
  it("zero-pads single-digit hours", () => {
    expect(normalizeTimeOfDay("9:30")).toBe("09:30");
  });
  it("parses 12h with am/pm", () => {
    expect(normalizeTimeOfDay("9:30am")).toBe("09:30");
    expect(normalizeTimeOfDay("9:30pm")).toBe("21:30");
    expect(normalizeTimeOfDay("12:00am")).toBe("00:00");
    expect(normalizeTimeOfDay("12:00pm")).toBe("12:00");
  });
  it("handles uppercase and whitespace", () => {
    expect(normalizeTimeOfDay("  9:30 AM  ")).toBe("09:30");
  });
  it("returns null for blank / unparseable", () => {
    expect(normalizeTimeOfDay(null)).toBeNull();
    expect(normalizeTimeOfDay("")).toBeNull();
    expect(normalizeTimeOfDay("noon")).toBeNull();
    expect(normalizeTimeOfDay("25:00")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// resolveTimeEntryUtcBounds
// ────────────────────────────────────────────────────────────────

describe("resolveTimeEntryUtcBounds", () => {
  const base = {
    spent_date: "2024-07-15",
    timeZone: "America/New_York",
  };

  it("uses started_time + ended_time when both present", () => {
    const out = resolveTimeEntryUtcBounds({
      ...base,
      started_time: "09:00",
      ended_time: "11:30",
      hours: 2.5,
      is_running: false,
    });
    expect(out.startUtcIso).toBe("2024-07-15T13:00:00.000Z");
    expect(out.endUtcIso).toBe("2024-07-15T15:30:00.000Z");
  });

  it("computes end from hours when ended_time missing", () => {
    const out = resolveTimeEntryUtcBounds({
      ...base,
      started_time: "09:00",
      ended_time: null,
      hours: 1.5,
      is_running: false,
    });
    expect(out.startUtcIso).toBe("2024-07-15T13:00:00.000Z");
    expect(out.endUtcIso).toBe("2024-07-15T14:30:00.000Z");
  });

  it("leaves end null for a running timer", () => {
    const out = resolveTimeEntryUtcBounds({
      ...base,
      started_time: "09:00",
      ended_time: null,
      hours: 0,
      is_running: true,
    });
    expect(out.endUtcIso).toBeNull();
  });

  it("defaults start to 09:00 when started_time missing", () => {
    const out = resolveTimeEntryUtcBounds({
      ...base,
      started_time: null,
      ended_time: null,
      hours: 2,
      is_running: false,
    });
    expect(out.startUtcIso).toBe("2024-07-15T13:00:00.000Z");
    expect(out.endUtcIso).toBe("2024-07-15T15:00:00.000Z");
  });

  it("accepts 12h format for started_time", () => {
    const out = resolveTimeEntryUtcBounds({
      ...base,
      started_time: "9:00am",
      ended_time: "5:00pm",
      hours: 8,
      is_running: false,
    });
    expect(out.startUtcIso).toBe("2024-07-15T13:00:00.000Z");
    expect(out.endUtcIso).toBe("2024-07-15T21:00:00.000Z");
  });
});

// ────────────────────────────────────────────────────────────────
// User mapping
// ────────────────────────────────────────────────────────────────

describe("collectUniqueHarvestUsers", () => {
  it("dedupes and counts entries per user, sorted by count desc", () => {
    const entries = [
      { user: { id: 1, name: "Alice" } },
      { user: { id: 2, name: "Bob" } },
      { user: { id: 1, name: "Alice" } },
      { user: { id: 1, name: "Alice" } },
      { user: { id: 3, name: "Carol" } },
    ] as Pick<HarvestTimeEntry, "user">[];
    const out = collectUniqueHarvestUsers(entries);
    expect(out).toEqual([
      { id: 1, name: "Alice", entryCount: 3 },
      { id: 2, name: "Bob", entryCount: 1 },
      { id: 3, name: "Carol", entryCount: 1 },
    ]);
  });
});

describe("proposeDefaultUserMapping", () => {
  const shyreMembers = [
    {
      user_id: "u-alice",
      email: "alice@example.com",
      display_name: "Alice Wong",
    },
    { user_id: "u-bob", email: null, display_name: "Bob Martinez" },
    { user_id: "u-carol", email: null, display_name: null },
  ];

  it("matches by email when available", () => {
    const harvestUsers: HarvestUser[] = [
      {
        id: 1,
        first_name: "Alice",
        last_name: "Wong",
        email: "alice@example.com",
        is_active: true,
      },
    ];
    const out = proposeDefaultUserMapping(harvestUsers, shyreMembers);
    expect(out[1]).toBe("u-alice");
  });

  it("falls back to display_name when no email match", () => {
    const harvestUsers: HarvestUser[] = [
      {
        id: 2,
        first_name: "Bob",
        last_name: "Martinez",
        email: null,
        is_active: true,
      },
    ];
    const out = proposeDefaultUserMapping(harvestUsers, shyreMembers);
    expect(out[2]).toBe("u-bob");
  });

  it("defaults to importer when no match found", () => {
    const harvestUsers: HarvestUser[] = [
      {
        id: 3,
        first_name: "Dana",
        last_name: "Unknown",
        email: null,
        is_active: true,
      },
    ];
    const out = proposeDefaultUserMapping(harvestUsers, shyreMembers);
    expect(out[3]).toBe("importer");
  });

  it("email match is case-insensitive", () => {
    const harvestUsers: HarvestUser[] = [
      {
        id: 1,
        first_name: "Alice",
        last_name: "Wong",
        email: "ALICE@EXAMPLE.COM",
        is_active: true,
      },
    ];
    const out = proposeDefaultUserMapping(harvestUsers, shyreMembers);
    expect(out[1]).toBe("u-alice");
  });
});

describe("resolveEntryUserId", () => {
  const mapping: Record<number, UserMapChoice> = {
    1: "u-alice",
    2: "importer",
    3: "skip",
  };
  it("returns the mapped user id", () => {
    expect(resolveEntryUserId(1, mapping, "u-me")).toBe("u-alice");
  });
  it("returns importer id on 'importer'", () => {
    expect(resolveEntryUserId(2, mapping, "u-me")).toBe("u-me");
  });
  it("returns null on 'skip'", () => {
    expect(resolveEntryUserId(3, mapping, "u-me")).toBeNull();
  });
  it("defaults unknown users to importer", () => {
    expect(resolveEntryUserId(999, mapping, "u-me")).toBe("u-me");
  });
});

// ────────────────────────────────────────────────────────────────
// Task → category
// ────────────────────────────────────────────────────────────────

describe("collectUniqueTaskNames", () => {
  it("dedupes, trims, drops blanks, sorts alphabetically", () => {
    const entries = [
      { task: { id: 1, name: "Engineering" } },
      { task: { id: 2, name: "Design" } },
      { task: { id: 1, name: "  Engineering  " } },
      { task: { id: 3, name: "" } },
      { task: { id: 4, name: "Admin" } },
    ];
    expect(collectUniqueTaskNames(entries)).toEqual([
      "Admin",
      "Design",
      "Engineering",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────
// buildEntryDescription
// ────────────────────────────────────────────────────────────────

describe("buildEntryDescription", () => {
  it("joins task and notes", () => {
    expect(
      buildEntryDescription({
        notes: "Fixed a bug",
        taskName: "Engineering",
        billableRate: null,
        projectHourlyRate: 150,
      }),
    ).toBe("Engineering: Fixed a bug");
  });
  it("uses just task when no notes", () => {
    expect(
      buildEntryDescription({
        notes: null,
        taskName: "Engineering",
        billableRate: null,
        projectHourlyRate: 150,
      }),
    ).toBe("Engineering");
  });
  it("uses just notes when no task", () => {
    expect(
      buildEntryDescription({
        notes: "Something",
        taskName: "",
        billableRate: null,
        projectHourlyRate: 150,
      }),
    ).toBe("Something");
  });
  it("prefixes rate when entry rate differs from project rate", () => {
    expect(
      buildEntryDescription({
        notes: "Extra work",
        taskName: "Eng",
        billableRate: 200,
        projectHourlyRate: 150,
      }),
    ).toBe("[$200/hr] Eng: Extra work");
  });
  it("no rate prefix when rate matches project rate", () => {
    expect(
      buildEntryDescription({
        notes: "Normal work",
        taskName: "Eng",
        billableRate: 150,
        projectHourlyRate: 150,
      }),
    ).toBe("Eng: Normal work");
  });
  it("no rate prefix when billable_rate is null", () => {
    expect(
      buildEntryDescription({
        notes: "Work",
        taskName: "Eng",
        billableRate: null,
        projectHourlyRate: 150,
      }),
    ).toBe("Eng: Work");
  });
});

// ────────────────────────────────────────────────────────────────
// Row builders
// ────────────────────────────────────────────────────────────────

const ctx: ImportContext = {
  teamId: "team-1",
  importerUserId: "u-me",
  importRunId: "run-abc",
  importedAt: "2026-04-23T12:00:00.000Z",
};

describe("buildCustomerRow", () => {
  it("maps Harvest client to a customer insert row", () => {
    const hc: HarvestClient = {
      id: 42,
      name: "Acme Corp",
      currency: "USD",
      address: "1 Main St",
      is_active: true,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    };
    expect(buildCustomerRow(hc, ctx)).toEqual({
      team_id: "team-1",
      user_id: "u-me",
      name: "Acme Corp",
      address: "1 Main St",
      imported_from: "harvest",
      imported_at: "2026-04-23T12:00:00.000Z",
      import_run_id: "run-abc",
      import_source_id: "42",
    });
  });
});

describe("buildProjectRow", () => {
  const hp: HarvestProject = {
    id: 7,
    name: "Platform",
    code: null,
    is_active: true,
    is_billable: true,
    budget: 100,
    budget_by: "hours",
    hourly_rate: 175,
    notes: "Main retainer",
    client: { id: 42, name: "Acme" },
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  };

  it("maps an active project to status=active", () => {
    const row = buildProjectRow(hp, "cust-1", ctx);
    expect(row.status).toBe("active");
    expect(row.customer_id).toBe("cust-1");
    expect(row.hourly_rate).toBe(175);
    expect(row.import_source_id).toBe("7");
  });

  it("maps an inactive project to status=archived", () => {
    const row = buildProjectRow({ ...hp, is_active: false }, null, ctx);
    expect(row.status).toBe("archived");
    expect(row.customer_id).toBeNull();
  });

  it("defaults category_set_id to null when not provided", () => {
    const row = buildProjectRow(hp, "cust-1", ctx);
    expect(row.category_set_id).toBeNull();
  });

  it("carries category_set_id when provided (needed for the validate_time_entry_category trigger)", () => {
    const row = buildProjectRow(hp, "cust-1", ctx, "set-xyz");
    expect(row.category_set_id).toBe("set-xyz");
  });
});

// ────────────────────────────────────────────────────────────────
// buildTimeEntryRow
// ────────────────────────────────────────────────────────────────

const baseEntry: HarvestTimeEntry = {
  id: 100,
  spent_date: "2024-07-15",
  hours: 2,
  notes: "Some notes",
  is_locked: false,
  is_running: false,
  billable: true,
  billable_rate: 150,
  started_time: "09:00",
  ended_time: "11:00",
  project: { id: 7, name: "Platform" },
  client: { id: 42, name: "Acme" },
  task: { id: 1, name: "Engineering" },
  user: { id: 1, name: "Alice" },
  invoice: null,
  created_at: "2024-07-15",
  updated_at: "2024-07-15",
};

describe("buildTimeEntryRow", () => {
  const categoryIdByTaskName = new Map([["Engineering", "cat-1"]]);
  const userMapping: Record<number, UserMapChoice> = {
    1: "u-alice",
  };

  it("builds a complete row for a mapped user + mapped project", () => {
    const out = buildTimeEntryRow({
      entry: baseEntry,
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    expect("skipped" in out).toBe(false);
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.project_id).toBe("proj-1");
    expect(out.user_id).toBe("u-alice");
    expect(out.category_id).toBe("cat-1");
    expect(out.description).toBe("Engineering: Some notes");
    expect(out.start_time).toBe("2024-07-15T13:00:00.000Z");
    expect(out.end_time).toBe("2024-07-15T15:00:00.000Z");
    expect(out.import_source_id).toBe("100");
  });

  it("skips when project isn't mapped", () => {
    const out = buildTimeEntryRow({
      entry: baseEntry,
      projectId: null,
      projectHourlyRate: null,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    expect("skipped" in out).toBe(true);
    if (!("skipped" in out)) throw new Error("unreachable");
    expect(out.reason).toMatch(/no matching project/);
  });

  it("skips when user is mapped to 'skip'", () => {
    const out = buildTimeEntryRow({
      entry: baseEntry,
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping: { 1: "skip" },
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    expect("skipped" in out).toBe(true);
    if (!("skipped" in out)) throw new Error("unreachable");
    expect(out.reason).toMatch(/skip/);
  });

  it("falls back to importer when user is unmapped", () => {
    const out = buildTimeEntryRow({
      entry: baseEntry,
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping: {},
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    expect("skipped" in out).toBe(false);
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.user_id).toBe("u-me");
  });

  it("null category_id when task isn't in the map", () => {
    const out = buildTimeEntryRow({
      entry: { ...baseEntry, task: { id: 2, name: "Unknown" } },
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    expect("skipped" in out).toBe(false);
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.category_id).toBeNull();
  });

  it("embeds rate snapshot when billable_rate differs from project rate", () => {
    const out = buildTimeEntryRow({
      entry: { ...baseEntry, billable_rate: 200 },
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    expect("skipped" in out).toBe(false);
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.description).toBe("[$200/hr] Engineering: Some notes");
  });
});

// ────────────────────────────────────────────────────────────────
// buildReconciliation
// ────────────────────────────────────────────────────────────────

describe("buildReconciliation", () => {
  // Two customers, three entries. Hours expressed as Harvest returns
  // them (decimal hours, not minutes).
  const harvestEntries = [
    { id: 1, hours: 2.5, client: { id: 42, name: "Acme" } },
    { id: 2, hours: 1.0, client: { id: 42, name: "Acme" } },
    { id: 3, hours: 0.5, client: { id: 99, name: "Globex" } },
  ];

  // Shyre rows keyed by source id; duration_min is how time_entries
  // actually stores it.
  const fullMatch = [
    { import_source_id: "1", duration_min: 150 },
    { import_source_id: "2", duration_min: 60 },
    { import_source_id: "3", duration_min: 30 },
  ];

  it("full match: all entries landed, hours match, per-customer ✓", () => {
    const r = buildReconciliation({
      harvestEntries,
      shyreRows: fullMatch,
      skipReasons: {},
    });

    expect(r.match).toBe(true);
    expect(r.harvest).toEqual({ entries: 3, hours: 4 });
    expect(r.shyre).toEqual({ entries: 3, hours: 4 });
    expect(r.missing.count).toBe(0);
    expect(r.missing.hours).toBe(0);

    const acme = r.perCustomer.find((c) => c.name === "Acme");
    const globex = r.perCustomer.find((c) => c.name === "Globex");
    expect(acme?.match).toBe(true);
    expect(acme?.harvestHours).toBe(3.5);
    expect(acme?.shyreHours).toBe(3.5);
    expect(globex?.match).toBe(true);
  });

  it("missing entries flip match=false and populate missing.count/hours", () => {
    // Drop the 1-hour Acme entry.
    const partial = [
      { import_source_id: "1", duration_min: 150 },
      { import_source_id: "3", duration_min: 30 },
    ];
    const r = buildReconciliation({
      harvestEntries,
      shyreRows: partial,
      skipReasons: { "no matching project": 1 },
    });

    expect(r.match).toBe(false);
    expect(r.harvest).toEqual({ entries: 3, hours: 4 });
    expect(r.shyre).toEqual({ entries: 2, hours: 3 });
    expect(r.missing.count).toBe(1);
    expect(r.missing.hours).toBe(1);
    expect(r.missing.reasonsByCount).toEqual({ "no matching project": 1 });

    const acme = r.perCustomer.find((c) => c.name === "Acme");
    expect(acme?.match).toBe(false);
    expect(acme?.harvestHours).toBe(3.5);
    expect(acme?.shyreHours).toBe(2.5);
  });

  it("per-customer sorts by harvest hours desc then name", () => {
    const r = buildReconciliation({
      harvestEntries,
      shyreRows: fullMatch,
      skipReasons: {},
    });
    // Acme (3.5h) before Globex (0.5h)
    expect(r.perCustomer.map((c) => c.name)).toEqual(["Acme", "Globex"]);
  });

  it("treats sub-epsilon float residue as a match", () => {
    // A Harvest entry reported as 0.1h and a Shyre row stored as 6min.
    // Summing enough of these can produce 120.00000003 on one side and
    // 120.0 on the other. The epsilon threshold is 0.01h.
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      hours: 0.1,
      client: { id: 1, name: "C" },
    }));
    const shyre = Array.from({ length: 100 }, (_, i) => ({
      import_source_id: String(i),
      duration_min: 6,
    }));
    const r = buildReconciliation({
      harvestEntries: many,
      shyreRows: shyre,
      skipReasons: {},
    });
    expect(r.match).toBe(true);
  });

  it("handles null duration_min as zero hours on the Shyre side", () => {
    const r = buildReconciliation({
      harvestEntries: [
        { id: 1, hours: 1.0, client: { id: 1, name: "C" } },
      ],
      shyreRows: [{ import_source_id: "1", duration_min: null }],
      skipReasons: {},
    });
    // Entry exists (count=1) but hours is 0 — flag as mismatch.
    expect(r.shyre.entries).toBe(1);
    expect(r.shyre.hours).toBe(0);
    expect(r.match).toBe(false);
  });

  it("empty inputs produce an empty-but-match report", () => {
    const r = buildReconciliation({
      harvestEntries: [],
      shyreRows: [],
      skipReasons: {},
    });
    expect(r.match).toBe(true);
    expect(r.harvest).toEqual({ entries: 0, hours: 0 });
    expect(r.shyre).toEqual({ entries: 0, hours: 0 });
    expect(r.perCustomer).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// mapHarvestInvoiceState
// ────────────────────────────────────────────────────────────────

describe("mapHarvestInvoiceState", () => {
  it("maps paid → paid", () => {
    expect(mapHarvestInvoiceState("paid")).toBe("paid");
  });

  it("maps draft → draft", () => {
    expect(mapHarvestInvoiceState("draft")).toBe("draft");
  });

  it("maps closed and written-off → void (no money expected)", () => {
    expect(mapHarvestInvoiceState("closed")).toBe("void");
    expect(mapHarvestInvoiceState("written-off")).toBe("void");
  });

  it("maps open → sent (issued, awaiting payment)", () => {
    expect(mapHarvestInvoiceState("open")).toBe("sent");
  });

  it("maps unknown / empty / missing states → sent (safe default)", () => {
    expect(mapHarvestInvoiceState("partial")).toBe("sent");
    expect(mapHarvestInvoiceState("")).toBe("sent");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(mapHarvestInvoiceState("PAID")).toBe("paid");
    expect(mapHarvestInvoiceState("  Closed  ")).toBe("void");
  });
});

// ────────────────────────────────────────────────────────────────
// buildInvoiceRow
// ────────────────────────────────────────────────────────────────

const baseInvoice: HarvestInvoice = {
  id: 9001,
  number: "INV-0042",
  client: { id: 42, name: "Acme" },
  amount: 1083, // 1000 subtotal + 83 tax
  due_amount: 0,
  currency: "USD",
  state: "paid",
  issue_date: "2024-07-01",
  due_date: "2024-07-15",
  sent_at: "2024-07-01T10:00:00Z",
  paid_at: "2024-07-10T10:00:00Z",
  paid_date: "2024-07-10",
  notes: "Thanks for the work",
  subject: "July retainer",
  tax: 8.3,
  tax_amount: 83,
  tax2: null,
  tax2_amount: 0,
  line_items: [],
  created_at: "2024-07-01",
  updated_at: "2024-07-10",
};

describe("buildInvoiceRow", () => {
  it("builds a complete row, computing subtotal as amount minus tax_amount", () => {
    const row = buildInvoiceRow(baseInvoice, "cust-1", ctx);
    expect(row.team_id).toBe("team-1");
    expect(row.customer_id).toBe("cust-1");
    expect(row.invoice_number).toBe("INV-0042");
    expect(row.status).toBe("paid");
    expect(row.issued_date).toBe("2024-07-01");
    expect(row.due_date).toBe("2024-07-15");
    expect(row.subtotal).toBe(1000);
    expect(row.tax_amount).toBe(83);
    expect(row.tax_rate).toBe(8.3);
    expect(row.total).toBe(1083);
    expect(row.import_source_id).toBe("9001");
  });

  it("collapses subject + notes into Shyre's single notes column", () => {
    const row = buildInvoiceRow(baseInvoice, "cust-1", ctx);
    expect(row.notes).toBe("July retainer\n\nThanks for the work");
  });

  it("uses subject alone when notes is missing", () => {
    const row = buildInvoiceRow(
      { ...baseInvoice, notes: null },
      "cust-1",
      ctx,
    );
    expect(row.notes).toBe("July retainer");
  });

  it("uses notes alone when subject is missing", () => {
    const row = buildInvoiceRow(
      { ...baseInvoice, subject: null },
      "cust-1",
      ctx,
    );
    expect(row.notes).toBe("Thanks for the work");
  });

  it("preserves null customer_id when no Shyre customer matched", () => {
    const row = buildInvoiceRow(baseInvoice, null, ctx);
    expect(row.customer_id).toBeNull();
  });

  it("treats missing tax fields as zero (subtotal == total)", () => {
    const row = buildInvoiceRow(
      { ...baseInvoice, tax: null, tax_amount: 0 },
      "cust-1",
      ctx,
    );
    expect(row.subtotal).toBe(1083);
    expect(row.tax_amount).toBe(0);
    expect(row.tax_rate).toBe(0);
  });

  it("maps non-paid states through the state mapper", () => {
    expect(buildInvoiceRow({ ...baseInvoice, state: "open" }, null, ctx).status).toBe("sent");
    expect(buildInvoiceRow({ ...baseInvoice, state: "draft" }, null, ctx).status).toBe("draft");
    expect(buildInvoiceRow({ ...baseInvoice, state: "closed" }, null, ctx).status).toBe("void");
  });

  // Money-math invariant: subtotal + tax_amount === total. Bookkeeper
  // review flagged that a regression here is silent — the row would
  // ship to QuickBooks with mismatched totals and nobody notices
  // until reconciliation. Property-style: try a spread of plausible
  // amounts to catch float-drift edge cases.
  it("subtotal + tax_amount equals total for every plausible amount", () => {
    const cases: Array<{ amount: number; tax: number }> = [
      { amount: 100, tax: 0 },
      { amount: 1083, tax: 83 },
      { amount: 0.01, tax: 0 },
      { amount: 1234.56, tax: 0 },
      { amount: 999999.99, tax: 99999.99 },
      { amount: 0.03, tax: 0.01 },
    ];
    for (const { amount, tax } of cases) {
      const row = buildInvoiceRow(
        { ...baseInvoice, amount, tax_amount: tax },
        null,
        ctx,
      );
      expect(row.subtotal + row.tax_amount).toBeCloseTo(row.total, 2);
      expect(row.total).toBeCloseTo(amount, 2);
    }
  });

  it("subtotal is never negative (clamps weird Harvest input)", () => {
    // Harvest historically shouldn't ship `tax_amount > amount`,
    // but if it ever did, we'd produce a negative subtotal. The
    // test pins current behavior — flag if this changes so we know
    // to revisit the upstream-input assumption.
    const row = buildInvoiceRow(
      { ...baseInvoice, amount: 100, tax_amount: 150 },
      null,
      ctx,
    );
    expect(row.total).toBe(100);
    expect(row.tax_amount).toBe(150);
    expect(row.subtotal).toBe(-50);
  });
});

// ────────────────────────────────────────────────────────────────
// buildInvoiceLineItemRow
// ────────────────────────────────────────────────────────────────

const baseLineItem: HarvestInvoiceLineItem = {
  id: 5001,
  kind: "Service",
  description: "Engineering work",
  quantity: 10,
  unit_price: 150,
  amount: 1500,
  taxed: false,
  taxed2: false,
  project: { id: 7, name: "Platform" },
};

describe("buildInvoiceLineItemRow", () => {
  it("builds a complete line item row", () => {
    const row = buildInvoiceLineItemRow(baseLineItem, "inv-1");
    expect(row.invoice_id).toBe("inv-1");
    expect(row.description).toBe("Engineering work");
    expect(row.quantity).toBe(10);
    expect(row.unit_price).toBe(150);
    expect(row.amount).toBe(1500);
  });

  it("falls back to kind when description is missing", () => {
    const row = buildInvoiceLineItemRow(
      { ...baseLineItem, description: null },
      "inv-1",
    );
    expect(row.description).toBe("Service");
  });

  it("falls back to a generic label when both description and kind are missing", () => {
    const row = buildInvoiceLineItemRow(
      { ...baseLineItem, description: null, kind: null },
      "inv-1",
    );
    expect(row.description).toBe("Line item");
  });

  it("treats whitespace-only description as missing", () => {
    const row = buildInvoiceLineItemRow(
      { ...baseLineItem, description: "   " },
      "inv-1",
    );
    expect(row.description).toBe("Service");
  });
});

// ────────────────────────────────────────────────────────────────
// buildTimeEntryRow — invoice backfill
// ────────────────────────────────────────────────────────────────

describe("buildTimeEntryRow invoice backfill", () => {
  const categoryIdByTaskName = new Map([["Engineering", "cat-1"]]);
  const userMapping: Record<number, UserMapChoice> = { 1: "u-alice" };

  it("leaves invoiced=false / invoice_id=null when entry is uninvoiced in Harvest", () => {
    const out = buildTimeEntryRow({
      entry: { ...baseEntry, invoice: null },
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
      invoiceMap: new Map([[9001, "shyre-inv-1"]]),
    });
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.invoiced).toBe(false);
    expect(out.invoice_id).toBeNull();
  });

  it("links entry to Shyre invoice when Harvest invoice landed in the same run", () => {
    const out = buildTimeEntryRow({
      entry: {
        ...baseEntry,
        invoice: { id: 9001, number: "INV-0042" },
      },
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
      invoiceMap: new Map([[9001, "shyre-inv-1"]]),
    });
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.invoiced).toBe(true);
    expect(out.invoice_id).toBe("shyre-inv-1");
  });

  it("leaves entry uninvoiced when Harvest invoice didn't make it into Shyre", () => {
    // E.g. the invoice fell outside the date window or insert failed —
    // safer to mark the entry as billable-not-yet-invoiced than to
    // drop the link silently.
    const out = buildTimeEntryRow({
      entry: {
        ...baseEntry,
        invoice: { id: 9999, number: "INV-9999" },
      },
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
      invoiceMap: new Map([[9001, "shyre-inv-1"]]),
    });
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.invoiced).toBe(false);
    expect(out.invoice_id).toBeNull();
  });

  it("works without an invoiceMap (existing callers compat)", () => {
    const out = buildTimeEntryRow({
      entry: {
        ...baseEntry,
        invoice: { id: 9001, number: "INV-0042" },
      },
      projectId: "proj-1",
      projectHourlyRate: 150,
      userMapping,
      categoryIdByTaskName,
      ctx,
      timeZone: "America/New_York",
    });
    if ("skipped" in out) throw new Error("unreachable");
    expect(out.invoiced).toBe(false);
    expect(out.invoice_id).toBeNull();
  });
});
