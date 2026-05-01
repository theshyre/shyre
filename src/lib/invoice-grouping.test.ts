import { describe, it, expect } from "vitest";
import {
  groupEntriesIntoLineItems,
  type EntryCandidate,
} from "./invoice-grouping";

function entry(over: Partial<EntryCandidate> = {}): EntryCandidate {
  // Spread the defaults first so explicit `null` overrides survive
  // (?? would treat null as "missing" and reapply the default).
  return {
    id: "e1",
    durationMin: 60,
    rate: 150,
    description: null,
    projectName: "Platform",
    taskName: "Engineering",
    personName: "Alex",
    date: "2026-04-15",
    ...over,
  };
}

describe("groupEntriesIntoLineItems", () => {
  it("by_project: collapses entries on the same project at the same rate", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", durationMin: 90 }),
        entry({ id: "b", durationMin: 30 }),
      ],
      "by_project",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Platform",
      quantity: 2,
      unitPrice: 150,
      amount: 300,
    });
    expect(lines[0]?.sourceEntryIds).toEqual(["a", "b"]);
  });

  it("by_task: groups by task name, not project", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", taskName: "Code Review", durationMin: 60 }),
        entry({ id: "b", taskName: "Code Review", durationMin: 30 }),
        entry({ id: "c", taskName: "Engineering", durationMin: 60 }),
      ],
      "by_task",
    );
    expect(lines).toHaveLength(2);
    const review = lines.find((l) => l.description === "Code Review");
    const engineering = lines.find((l) => l.description === "Engineering");
    expect(review?.quantity).toBe(1.5);
    expect(engineering?.quantity).toBe(1);
  });

  it("by_person: groups by person", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", personName: "Alex", durationMin: 60 }),
        entry({ id: "b", personName: "Jamie", durationMin: 90 }),
      ],
      "by_person",
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.description).sort()).toEqual(["Alex", "Jamie"]);
  });

  it("detailed: one line per entry, prefers user description", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", description: "Auth refactor", durationMin: 60 }),
        entry({ id: "b", description: null, durationMin: 30 }),
      ],
      "detailed",
    );
    expect(lines).toHaveLength(2);
    // Sort is alphabetical by description; "Auth refactor" < "Platform"
    expect(lines[0]?.description).toBe("Auth refactor");
    expect(lines[1]?.description).toBe("Platform");
  });

  it("mixed-rate split: same project + different rates → separate lines with rate suffix", () => {
    // Bookkeeper rule: unit_price shouldn't lie. Two members on the
    // same project at $150 and $185 produce two lines.
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", rate: 150, durationMin: 60 }),
        entry({ id: "b", rate: 185, durationMin: 60 }),
      ],
      "by_project",
    );
    expect(lines).toHaveLength(2);
    const cheaper = lines.find((l) => l.unitPrice === 150);
    const dearer = lines.find((l) => l.unitPrice === 185);
    expect(cheaper?.description).toBe("Platform (@ $150.00/hr)");
    expect(dearer?.description).toBe("Platform (@ $185.00/hr)");
  });

  it("rounding invariant: per-entry round, then sum (not the other way)", () => {
    // Two entries at 0.005h * $300 = $1.5 each. Per-entry round
    // (1.50 + 1.50) = 3.00. Wrong order ((0.01) * 300) = 3.00 — same
    // here but the invariant matters when fractions of cents drift.
    // Pin the actual value at 1/3 hour * $99 = 33.0 (33.00 + 33.00 = 66).
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", rate: 99, durationMin: 20 }),
        entry({ id: "b", rate: 99, durationMin: 20 }),
      ],
      "by_project",
    );
    // 20 min = 0.33h. round(0.33 * 99) = round(32.67) = 32.67. Two of
    // those = 65.34. Quantity = 0.66 (sum of two 0.33s).
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(0.66);
    expect(lines[0]?.amount).toBeCloseTo(65.34, 2);
  });

  it("preserves source entry ids so the action can mark them invoiced", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", durationMin: 60 }),
        entry({ id: "b", durationMin: 60 }),
      ],
      "by_project",
    );
    expect(lines[0]?.sourceEntryIds).toEqual(["a", "b"]);
  });

  it("emits stable alphabetical line order across reloads", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", projectName: "Zeta" }),
        entry({ id: "b", projectName: "Alpha" }),
        entry({ id: "c", projectName: "Mu" }),
      ],
      "by_project",
    );
    expect(lines.map((l) => l.description)).toEqual(["Alpha", "Mu", "Zeta"]);
  });

  it("by_task: nullable task falls back to a stable label", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", taskName: null, durationMin: 60 }),
        entry({ id: "b", taskName: null, durationMin: 60 }),
      ],
      "by_task",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe("Time");
    expect(lines[0]?.quantity).toBe(2);
  });

  it("returns [] on no entries (empty preview state)", () => {
    expect(groupEntriesIntoLineItems([], "by_project")).toEqual([]);
  });
});
