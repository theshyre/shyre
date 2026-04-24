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
  type ImportContext,
  type UserMapChoice,
} from "./harvest-import-logic";
import type {
  HarvestClient,
  HarvestProject,
  HarvestTimeEntry,
  HarvestUser,
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
