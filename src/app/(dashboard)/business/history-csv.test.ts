import { describe, it, expect } from "vitest";
import { expandToCsvRows } from "./history-csv";
import type { FieldChange } from "./[businessId]/people/history/history-format";

interface Entry {
  id: string;
  changedAt: string;
}

function base(entry: Entry): { changed_at: string; entry_id: string } {
  return { changed_at: entry.changedAt, entry_id: entry.id };
}

describe("expandToCsvRows", () => {
  it("emits one row per changed field", () => {
    const fields: FieldChange[] = [
      { key: "title", label: "Title", from: "Junior", to: "Senior" },
      {
        key: "compensation_amount_cents",
        label: "Compensation amount (cents)",
        from: 6000000,
        to: 8500000,
      },
    ];
    const rows = expandToCsvRows(
      [{ entry: { id: "e1", changedAt: "2026-04-15" }, fields }],
      base,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      changed_at: "2026-04-15",
      entry_id: "e1",
      field: "Title",
      previous_value: "Junior",
      new_value: "Senior",
    });
    expect(rows[1]?.field).toBe("Compensation amount (cents)");
    expect(rows[1]?.previous_value).toBe("6000000");
    expect(rows[1]?.new_value).toBe("8500000");
  });

  it("emits a single placeholder row when an entry has no labeled-field changes", () => {
    const rows = expandToCsvRows(
      [{ entry: { id: "e1", changedAt: "2026-04-15" }, fields: [] }],
      base,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entry_id: "e1",
      field: "",
      previous_value: "",
      new_value: "",
    });
  });

  it("renders an empty `to` side as empty string (most-recent-entry case)", () => {
    const fields: FieldChange[] = [
      { key: "title", label: "Title", from: "CEO", to: undefined },
    ];
    const rows = expandToCsvRows(
      [{ entry: { id: "e1", changedAt: "2026-04-15" }, fields }],
      base,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previous_value).toBe("CEO");
    expect(rows[0]?.new_value).toBe("");
  });

  it("preserves entry order across multiple entries", () => {
    const rows = expandToCsvRows(
      [
        {
          entry: { id: "newest", changedAt: "2026-04-15" },
          fields: [{ key: "x", label: "X", from: 1, to: 2 }],
        },
        {
          entry: { id: "older", changedAt: "2026-04-10" },
          fields: [{ key: "y", label: "Y", from: "a", to: "b" }],
        },
      ],
      base,
    );
    expect(rows.map((r) => r.entry_id)).toEqual(["newest", "older"]);
  });

  it("renders null / undefined / empty values as em-dashes via formatValue", () => {
    const fields: FieldChange[] = [
      { key: "ended_on", label: "Ended", from: null, to: "2026-04-01" },
      { key: "notes", label: "Notes", from: "", to: undefined },
    ];
    const rows = expandToCsvRows(
      [{ entry: { id: "e1", changedAt: "2026-04-15" }, fields }],
      base,
    );
    expect(rows[0]?.previous_value).toBe("—");
    expect(rows[0]?.new_value).toBe("2026-04-01");
    expect(rows[1]?.previous_value).toBe("—");
    expect(rows[1]?.new_value).toBe("");
  });

  it("returns an empty array for empty input", () => {
    expect(expandToCsvRows([], base)).toEqual([]);
  });
});
