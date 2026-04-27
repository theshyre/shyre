import { describe, it, expect } from "vitest";
import {
  computeFieldDiff,
  formatValue,
  formatTimestamp,
  isEqual,
  FIELD_LABELS,
  HIDDEN_KEYS,
} from "./history-format";

describe("formatValue", () => {
  it("renders null / undefined / empty string as em-dash", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue("")).toBe("—");
  });

  it("renders booleans as yes / no", () => {
    expect(formatValue(true)).toBe("yes");
    expect(formatValue(false)).toBe("no");
  });

  it("renders numbers as their string form", () => {
    expect(formatValue(0)).toBe("0");
    expect(formatValue(8500000)).toBe("8500000");
    expect(formatValue(-1.5)).toBe("-1.5");
  });

  it("renders strings unchanged", () => {
    expect(formatValue("Marcus")).toBe("Marcus");
    expect(formatValue("multi line\nstring")).toBe("multi line\nstring");
  });

  it("JSON-encodes objects / arrays", () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue([1, 2])).toBe("[1,2]");
  });
});

describe("formatTimestamp", () => {
  it("formats a valid ISO into a non-empty locale string", () => {
    const out = formatTimestamp("2026-04-15T13:30:00Z");
    // Locale-specific output is hard to assert exactly; just verify
    // we got a real string with a 4-digit year somewhere in it.
    expect(out).toMatch(/2026/);
    expect(out.length).toBeGreaterThan(5);
  });

  it("falls back to the raw input when the date is unparseable", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
  });
});

describe("isEqual", () => {
  it("matches reference / primitive equality", () => {
    expect(isEqual(1, 1)).toBe(true);
    expect(isEqual("a", "a")).toBe(true);
    expect(isEqual(true, true)).toBe(true);
  });

  it("treats null and undefined as distinct", () => {
    expect(isEqual(null, null)).toBe(true);
    expect(isEqual(null, undefined)).toBe(false);
    expect(isEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for type mismatches", () => {
    expect(isEqual(1, "1")).toBe(false);
    expect(isEqual(0, false)).toBe(false);
  });

  it("compares objects by JSON serialization", () => {
    expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    // Note: JSON ordering matters in this loose comparison.
    expect(isEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isEqual([1, 2], [1, 2])).toBe(true);
    expect(isEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe("computeFieldDiff", () => {
  it("most-recent entry (newer === null) enumerates previous values for labeled fields", () => {
    const diff = computeFieldDiff(
      {
        legal_name: "Robert Smith",
        compensation_amount_cents: 8500000,
        // hidden — should not appear
        id: "abc",
        business_id: "xyz",
        // unlabeled — should not appear
        random_unknown_column: "ignored",
      },
      null,
    );
    const keys = diff.map((d) => d.key);
    expect(keys).toContain("legal_name");
    expect(keys).toContain("compensation_amount_cents");
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("business_id");
    expect(keys).not.toContain("random_unknown_column");
    expect(diff.find((d) => d.key === "legal_name")?.from).toBe(
      "Robert Smith",
    );
    expect(diff.find((d) => d.key === "legal_name")?.to).toBeUndefined();
  });

  it("with a newer entry, surfaces only fields whose values differ", () => {
    const diff = computeFieldDiff(
      {
        legal_name: "Robert Smith",
        compensation_amount_cents: 8500000,
        title: "Senior",
      },
      {
        legal_name: "Robert Smith", // unchanged
        compensation_amount_cents: 6000000, // changed
        title: "Senior", // unchanged
      },
    );
    expect(diff.map((d) => d.key)).toEqual(["compensation_amount_cents"]);
    expect(diff[0]!.from).toBe(8500000);
    expect(diff[0]!.to).toBe(6000000);
  });

  it("treats null vs missing-key as different (the move surfaces in audit)", () => {
    const diff = computeFieldDiff(
      { ended_on: null },
      { ended_on: "2026-04-01" },
    );
    expect(diff.map((d) => d.key)).toContain("ended_on");
  });

  it("returns an empty diff when the two snapshots are equivalent", () => {
    const diff = computeFieldDiff(
      { legal_name: "Robert Smith", title: "CEO" },
      { legal_name: "Robert Smith", title: "CEO" },
    );
    expect(diff).toEqual([]);
  });

  it("preserves FIELD_LABELS order in the output", () => {
    const labelOrder = Object.keys(FIELD_LABELS);
    const titleIndex = labelOrder.indexOf("title");
    const cityIndex = labelOrder.indexOf("city");
    const diff = computeFieldDiff(
      { city: "Seattle", title: "Engineer" },
      { city: "Portland", title: "Director" },
    );
    const titlePos = diff.findIndex((d) => d.key === "title");
    const cityPos = diff.findIndex((d) => d.key === "city");
    // Whichever comes first in FIELD_LABELS should come first here.
    if (titleIndex < cityIndex) {
      expect(titlePos).toBeLessThan(cityPos);
    } else {
      expect(cityPos).toBeLessThan(titlePos);
    }
  });

  it("ignores fields that are present in HIDDEN_KEYS even on most-recent entry", () => {
    const diff = computeFieldDiff(
      {
        legal_name: "Robert",
        ...Object.fromEntries(
          Array.from(HIDDEN_KEYS).map((k) => [k, "noisy"]),
        ),
      },
      null,
    );
    for (const key of HIDDEN_KEYS) {
      expect(diff.map((d) => d.key)).not.toContain(key);
    }
    expect(diff.map((d) => d.key)).toContain("legal_name");
  });
});
