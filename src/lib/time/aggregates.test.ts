import { describe, it, expect, vi } from "vitest";
import {
  rollUp,
  timeEntriesAggregate,
  type TimeEntryAggregateRow,
} from "./aggregates";
import {
  springForwardEntries,
  fallBackEntries,
  nyeEntry,
  crossMidnightEntry,
  farFutureRunningTimer,
  makeEntry,
} from "@/__tests__/fixtures/time-edges";

interface RawRow {
  start_time: string;
  duration_min: number | null;
  billable: boolean;
}

function toRaw(entry: {
  start_time: string;
  duration_min: number | null;
  billable: boolean;
}): RawRow {
  return {
    start_time: entry.start_time,
    duration_min: entry.duration_min,
    billable: entry.billable,
  };
}

describe("rollUp", () => {
  describe("groupBy='day'", () => {
    it("buckets entries by UTC date", () => {
      const rows: RawRow[] = [
        { start_time: "2026-04-15T09:00:00.000Z", duration_min: 60, billable: true },
        { start_time: "2026-04-15T14:00:00.000Z", duration_min: 30, billable: false },
        { start_time: "2026-04-16T09:00:00.000Z", duration_min: 45, billable: true },
      ];
      const result = rollUp(rows, "day");
      expect(result).toEqual<TimeEntryAggregateRow[]>([
        { bucket: "2026-04-15", total_min: 90, billable_min: 60, entry_count: 2 },
        { bucket: "2026-04-16", total_min: 45, billable_min: 45, entry_count: 1 },
      ]);
    });

    it("attributes a cross-midnight entry to its start-day band only (start-day rule)", () => {
      // Per the doc decision (2026-04-30, bookkeeper review): full duration
      // counts toward the start_time's day, regardless of where end_time falls.
      const rows = [toRaw(crossMidnightEntry())];
      const result = rollUp(rows, "day");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        bucket: "2026-04-15",
        total_min: 60,
        billable_min: 60,
        entry_count: 1,
      });
    });

    it("places the NYE 23:45→00:30 cross-year entry on the start-day side (2025-12-31)", () => {
      const rows = [toRaw(nyeEntry())];
      const result = rollUp(rows, "day");
      expect(result).toHaveLength(1);
      expect(result[0]?.bucket).toBe("2025-12-31");
      expect(result[0]?.total_min).toBe(45);
    });

    it("renders both fall-back 01:30 occurrences into the same UTC day band", () => {
      // The wall-clock hour repeats locally; UTC is unambiguous. Both rows
      // land on 2026-11-01 with their distinct durations summed.
      const rows = fallBackEntries().map(toRaw);
      const result = rollUp(rows, "day");
      expect(result).toHaveLength(1);
      expect(result[0]?.bucket).toBe("2026-11-01");
      expect(result[0]?.entry_count).toBe(2);
      // Each entry is 15 min in the fixture
      expect(result[0]?.total_min).toBe(30);
    });

    it("excludes a running timer (duration_min=null) from totals", () => {
      const rows = [toRaw(farFutureRunningTimer())];
      const result = rollUp(rows, "day");
      expect(result).toEqual([]);
    });

    it("sums billable_min separately from total_min", () => {
      const rows: RawRow[] = [
        { start_time: "2026-04-15T09:00:00.000Z", duration_min: 60, billable: true },
        { start_time: "2026-04-15T11:00:00.000Z", duration_min: 30, billable: false },
        { start_time: "2026-04-15T13:00:00.000Z", duration_min: 45, billable: true },
      ];
      const result = rollUp(rows, "day");
      expect(result[0]?.total_min).toBe(135);
      expect(result[0]?.billable_min).toBe(105);
    });

    it("handles spring-forward entries deterministically (UTC)", () => {
      const rows = springForwardEntries().map(toRaw);
      const result = rollUp(rows, "day");
      expect(result).toHaveLength(1);
      expect(result[0]?.bucket).toBe("2026-03-08");
      expect(result[0]?.entry_count).toBe(2);
    });
  });

  describe("groupBy='week'", () => {
    it("buckets by ISO week", () => {
      // 2026-04-15 is Wed of ISO 2026-W16 (Mon Apr 13 – Sun Apr 19)
      const rows: RawRow[] = [
        { start_time: "2026-04-13T09:00:00.000Z", duration_min: 60, billable: true },
        { start_time: "2026-04-19T20:00:00.000Z", duration_min: 30, billable: true },
        { start_time: "2026-04-20T09:00:00.000Z", duration_min: 45, billable: true }, // W17
      ];
      const result = rollUp(rows, "week");
      expect(result).toEqual<TimeEntryAggregateRow[]>([
        { bucket: "2026-W16", total_min: 90, billable_min: 90, entry_count: 2 },
        { bucket: "2026-W17", total_min: 45, billable_min: 45, entry_count: 1 },
      ]);
    });

    it("uses ISO week 53 / week 1 correctly across year boundaries", () => {
      // 2026-01-01 is a Thursday → ISO week 1 of 2026.
      // 2025-12-29 (Mon) starts ISO 2026-W01 (per ISO).
      const rows: RawRow[] = [
        { start_time: "2025-12-29T09:00:00.000Z", duration_min: 60, billable: true },
        { start_time: "2026-01-01T09:00:00.000Z", duration_min: 30, billable: true },
      ];
      const result = rollUp(rows, "week");
      expect(result).toHaveLength(1);
      expect(result[0]?.bucket).toBe("2026-W01");
    });
  });

  describe("groupBy='month'", () => {
    it("buckets by UTC year-month", () => {
      const rows: RawRow[] = [
        { start_time: "2026-03-31T23:00:00.000Z", duration_min: 60, billable: true },
        { start_time: "2026-04-01T01:00:00.000Z", duration_min: 30, billable: true },
        { start_time: "2026-04-30T22:00:00.000Z", duration_min: 45, billable: true },
      ];
      const result = rollUp(rows, "month");
      expect(result).toEqual<TimeEntryAggregateRow[]>([
        { bucket: "2026-03", total_min: 60, billable_min: 60, entry_count: 1 },
        { bucket: "2026-04", total_min: 75, billable_min: 75, entry_count: 2 },
      ]);
    });
  });

  it("returns empty for empty input", () => {
    expect(rollUp([], "day")).toEqual([]);
  });

  it("ignores non-positive durations defensively", () => {
    const rows: RawRow[] = [
      { start_time: "2026-04-15T09:00:00.000Z", duration_min: 0, billable: true },
      { start_time: "2026-04-15T10:00:00.000Z", duration_min: -10, billable: true },
    ];
    expect(rollUp(rows, "day")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// timeEntriesAggregate (Supabase wiring)
//
// Verifies the helper passes the right filters to the client and threads the
// result through rollUp. The actual SQL is exercised against a real DB in the
// integration suite (see src/__integration__/rls/time-entries-rls.test.ts).
// ---------------------------------------------------------------------------

describe("timeEntriesAggregate (mocked client)", () => {
  function makeClient(rows: RawRow[]): {
    client: { from: ReturnType<typeof vi.fn> };
    chain: {
      eqs: Array<[string, unknown]>;
      ins: Array<[string, unknown]>;
      gtes: Array<[string, unknown]>;
      lts: Array<[string, unknown]>;
      iss: Array<[string, unknown]>;
    };
  } {
    const chain = { eqs: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown]>, gtes: [] as Array<[string, unknown]>, lts: [] as Array<[string, unknown]>, iss: [] as Array<[string, unknown]>, };
    interface Builder extends PromiseLike<{ data: RawRow[]; error: null }> {
      select: (s: string) => Builder;
      is: (k: string, v: unknown) => Builder;
      gte: (k: string, v: unknown) => Builder;
      lt: (k: string, v: unknown) => Builder;
      eq: (k: string, v: unknown) => Builder;
      in: (k: string, v: unknown) => Builder;
    }
    const builder = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn((k: string, v: unknown) => {
        chain.iss.push([k, v]);
        return builder;
      }),
      gte: vi.fn((k: string, v: unknown) => {
        chain.gtes.push([k, v]);
        return builder;
      }),
      lt: vi.fn((k: string, v: unknown) => {
        chain.lts.push([k, v]);
        return builder;
      }),
      eq: vi.fn((k: string, v: unknown) => {
        chain.eqs.push([k, v]);
        return builder;
      }),
      in: vi.fn((k: string, v: unknown) => {
        chain.ins.push([k, v]);
        return builder;
      }),
      then: (resolve: (value: { data: RawRow[]; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    } as unknown as Builder;
    const client = { from: vi.fn(() => builder) };
    return { client, chain };
  }

  it("threads team_id, billable, members and date range to the query", async () => {
    const { client, chain } = makeClient([]);
    await timeEntriesAggregate(client as never, {
      teamId: "team-1",
      fromUtc: new Date("2026-04-01T00:00:00.000Z"),
      toUtc: new Date("2026-05-01T00:00:00.000Z"),
      groupBy: "day",
      memberFilter: ["u-1", "u-2"],
      billableOnly: true,
    });
    expect(chain.eqs).toContainEqual(["team_id", "team-1"]);
    expect(chain.eqs).toContainEqual(["billable", true]);
    expect(chain.ins).toContainEqual(["user_id", ["u-1", "u-2"]]);
    expect(chain.gtes[0]?.[0]).toBe("start_time");
    expect(chain.lts[0]?.[0]).toBe("start_time");
    expect(chain.iss[0]).toEqual(["deleted_at", null]);
  });

  it("returns empty without hitting the DB when memberFilter is empty", async () => {
    const { client } = makeClient([]);
    const result = await timeEntriesAggregate(client as never, {
      teamId: "team-1",
      fromUtc: new Date("2026-04-01T00:00:00.000Z"),
      toUtc: new Date("2026-05-01T00:00:00.000Z"),
      groupBy: "day",
      memberFilter: [],
      billableOnly: false,
    });
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rolls up returned rows by day", async () => {
    const seed = makeEntry({
      id: "x",
      start: new Date("2026-04-15T09:00:00.000Z"),
      end: new Date("2026-04-15T10:00:00.000Z"),
    });
    const { client } = makeClient([toRaw(seed)]);
    const result = await timeEntriesAggregate(client as never, {
      teamId: "team-1",
      fromUtc: new Date("2026-04-01T00:00:00.000Z"),
      toUtc: new Date("2026-05-01T00:00:00.000Z"),
      groupBy: "day",
      memberFilter: null,
      billableOnly: false,
    });
    expect(result).toEqual<TimeEntryAggregateRow[]>([
      { bucket: "2026-04-15", total_min: 60, billable_min: 60, entry_count: 1 },
    ]);
  });
});
