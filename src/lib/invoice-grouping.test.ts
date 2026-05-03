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
    projectInvoiceCode: null,
    taskName: "Engineering",
    personName: "Alex",
    date: "2026-04-15",
    ...over,
  };
}

describe("groupEntriesIntoLineItems", () => {
  it("by_project: collapses entries on the same project at the same rate, with date range suffix", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", durationMin: 90, date: "2026-04-01" }),
        entry({ id: "b", durationMin: 30, date: "2026-04-30" }),
      ],
      "by_project",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Platform (04/01/2026 – 04/30/2026)",
      quantity: 2,
      unitPrice: 150,
      amount: 300,
    });
    expect(lines[0]?.sourceEntryIds).toEqual(["a", "b"]);
  });

  it("by_project: collapses to single date when all entries are on the same day", () => {
    const lines = groupEntriesIntoLineItems(
      [entry({ id: "a", durationMin: 60, date: "2026-04-15" })],
      "by_project",
    );
    expect(lines[0]?.description).toBe("Platform (04/15/2026)");
  });

  it("by_project: prefixes the [invoice_code] when set", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({
          id: "a",
          projectInvoiceCode: "PC-ITOPS",
          projectName: "Infrastructure & Systems Management (IT Ops)",
          date: "2026-04-15",
        }),
      ],
      "by_project",
    );
    expect(lines[0]?.description).toBe(
      "[PC-ITOPS] Infrastructure & Systems Management (IT Ops) (04/15/2026)",
    );
  });

  it("by_task: includes project name + task + date range (Harvest format)", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({
          id: "a",
          projectInvoiceCode: "PC-ITOPS",
          projectName: "Infrastructure & Systems Management (IT Ops)",
          taskName: "Security Administration",
          durationMin: 60,
          date: "2026-04-01",
        }),
        entry({
          id: "b",
          projectInvoiceCode: "PC-ITOPS",
          projectName: "Infrastructure & Systems Management (IT Ops)",
          taskName: "Security Administration",
          durationMin: 30,
          date: "2026-04-30",
        }),
      ],
      "by_task",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe(
      "[PC-ITOPS] Infrastructure & Systems Management (IT Ops): Security Administration (04/01/2026 – 04/30/2026)",
    );
  });

  it("by_task: same task on different projects → SEPARATE lines (cross-project bug fix)", () => {
    // Regression: previously by_task keyed on taskName alone, so
    // "Security Administration" on Project A and Project B
    // collapsed into a single line at one rate. Bookkeeper-flagged
    // correctness bug. Now keys on project + task.
    const lines = groupEntriesIntoLineItems(
      [
        entry({
          id: "a",
          projectName: "Project Alpha",
          taskName: "Security Administration",
          durationMin: 60,
          date: "2026-04-15",
        }),
        entry({
          id: "b",
          projectName: "Project Beta",
          taskName: "Security Administration",
          durationMin: 60,
          date: "2026-04-15",
        }),
      ],
      "by_task",
    );
    expect(lines).toHaveLength(2);
    expect(
      lines.map((l) => l.description).sort(),
    ).toEqual([
      "Project Alpha: Security Administration (04/15/2026)",
      "Project Beta: Security Administration (04/15/2026)",
    ]);
  });

  it("by_person: groups by project + person", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", personName: "Alex", durationMin: 60 }),
        entry({ id: "b", personName: "Jamie", durationMin: 90 }),
      ],
      "by_person",
    );
    expect(lines).toHaveLength(2);
    const labels = lines.map((l) => l.description).sort();
    expect(labels[0]).toMatch(/^Platform — Alex/);
    expect(labels[1]).toMatch(/^Platform — Jamie/);
  });

  it("detailed: one line per entry, prefers user description", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({
          id: "a",
          description: "Auth refactor",
          durationMin: 60,
          date: "2026-04-10",
        }),
        entry({
          id: "b",
          description: null,
          durationMin: 30,
          date: "2026-04-12",
        }),
      ],
      "detailed",
    );
    expect(lines).toHaveLength(2);
    // Sort is alphabetical by description; "Auth refactor" sorts
    // before "Platform" because "A" < "P".
    expect(lines[0]?.description).toMatch(/^Auth refactor/);
    expect(lines[1]?.description).toMatch(/^Platform/);
  });

  it("mixed-rate split: same project + different rates → separate lines with rate suffix", () => {
    // Bookkeeper rule: unit_price shouldn't lie. Two members on the
    // same project at $150 and $185 produce two lines.
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", rate: 150, durationMin: 60, date: "2026-04-15" }),
        entry({ id: "b", rate: 185, durationMin: 60, date: "2026-04-15" }),
      ],
      "by_project",
    );
    expect(lines).toHaveLength(2);
    const cheaper = lines.find((l) => l.unitPrice === 150);
    const dearer = lines.find((l) => l.unitPrice === 185);
    expect(cheaper?.description).toBe(
      "Platform (@ $150.00/hr) (04/15/2026)",
    );
    expect(dearer?.description).toBe(
      "Platform (@ $185.00/hr) (04/15/2026)",
    );
  });

  it("rounding invariant: per-entry round, then sum (not the other way)", () => {
    // 20 min = 0.33h. round(0.33 * 99) = round(32.67) = 32.67. Two of
    // those = 65.34. Quantity = 0.66 (sum of two 0.33s).
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", rate: 99, durationMin: 20 }),
        entry({ id: "b", rate: 99, durationMin: 20 }),
      ],
      "by_project",
    );
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
    expect(lines.map((l) => l.description.split(" ")[0])).toEqual([
      "Alpha",
      "Mu",
      "Zeta",
    ]);
  });

  it("by_task: nullable task falls back to a stable label (and still includes project)", () => {
    const lines = groupEntriesIntoLineItems(
      [
        entry({ id: "a", taskName: null, durationMin: 60 }),
        entry({ id: "b", taskName: null, durationMin: 60 }),
      ],
      "by_task",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toMatch(/^Platform: Time/);
    expect(lines[0]?.quantity).toBe(2);
  });

  it("returns [] on no entries (empty preview state)", () => {
    expect(groupEntriesIntoLineItems([], "by_project")).toEqual([]);
  });
});
