import { describe, it, expect } from "vitest";
import {
  computeFieldDiff,
  expandWithFieldDiffs,
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

  it("respects a custom labels map (most-recent entry path)", () => {
    const customLabels = { foo: "Foo Field", bar: "Bar Field" };
    const diff = computeFieldDiff(
      { foo: "alpha", bar: "beta", legal_name: "ignored" },
      null,
      { labels: customLabels, hiddenKeys: new Set() },
    );
    const keys = diff.map((d) => d.key);
    // legal_name is not in customLabels — should not appear.
    expect(keys).not.toContain("legal_name");
    expect(keys).toContain("foo");
    expect(keys).toContain("bar");
  });

  it("respects a custom labels map when diffing against a newer snapshot", () => {
    const customLabels = { foo: "Foo Field" };
    const diff = computeFieldDiff(
      { foo: "old", bar: "old" },
      { foo: "new", bar: "new" },
      { labels: customLabels, hiddenKeys: new Set() },
    );
    // bar isn't in customLabels — only foo surfaces.
    expect(diff.map((d) => d.key)).toEqual(["foo"]);
    expect(diff[0]?.from).toBe("old");
    expect(diff[0]?.to).toBe("new");
  });

  it("respects a custom hiddenKeys set", () => {
    const diff = computeFieldDiff(
      { legal_name: "Robert", title: "CEO" },
      null,
      {
        labels: { legal_name: "Legal name", title: "Title" },
        hiddenKeys: new Set(["title"]),
      },
    );
    expect(diff.map((d) => d.key)).toEqual(["legal_name"]);
  });
});

// ────────────────────────────────────────────────────────────────
// expandWithFieldDiffs
// ────────────────────────────────────────────────────────────────

describe("expandWithFieldDiffs", () => {
  type Entry = {
    id: string;
    group: string;
    when: string;
    state: Record<string, unknown>;
  };

  const labels = { legal_name: "Legal name", title: "Title" };
  const hiddenKeys = new Set<string>();

  it("computes per-entry diffs against the next-newer entry in the same group", () => {
    // newest first
    const entries: Entry[] = [
      { id: "e3", group: "g1", when: "2026-04-15", state: { legal_name: "Robert", title: "Director" } },
      { id: "e2", group: "g1", when: "2026-04-10", state: { legal_name: "Robert", title: "Senior" } },
      { id: "e1", group: "g1", when: "2026-04-01", state: { legal_name: "Bob", title: "Junior" } },
    ];
    const out = expandWithFieldDiffs({
      entries,
      groupKey: (e) => e.group,
      previousState: (e) => e.state,
      labels: () => labels,
      hiddenKeys,
    });
    // Newest entry — no newer neighbor, enumerates the snapshot.
    expect(out[0]?.entry.id).toBe("e3");
    expect(out[0]?.fields.map((f) => f.key).sort()).toEqual(["legal_name", "title"]);
    expect(out[0]?.fields[0]?.to).toBeUndefined();
    // Middle entry — diffs against e3.
    expect(out[1]?.entry.id).toBe("e2");
    expect(out[1]?.fields.map((f) => f.key)).toEqual(["title"]);
    expect(out[1]?.fields[0]?.from).toBe("Senior");
    expect(out[1]?.fields[0]?.to).toBe("Director");
    // Oldest — diffs against e2.
    expect(out[2]?.entry.id).toBe("e1");
    expect(out[2]?.fields.map((f) => f.key).sort()).toEqual(["legal_name", "title"]);
  });

  it("partitions diffs by groupKey", () => {
    const entries: Entry[] = [
      { id: "e2", group: "person-1", when: "2026-04-10", state: { legal_name: "Bob" } },
      // person-2's only entry — should get most-recent enumeration
      { id: "e1", group: "person-2", when: "2026-04-05", state: { legal_name: "Sue" } },
    ];
    const out = expandWithFieldDiffs({
      entries,
      groupKey: (e) => e.group,
      previousState: (e) => e.state,
      labels: () => labels,
      hiddenKeys,
    });
    // Both are most-recent for their respective groups — both get
    // enumerated, neither gets a "to" side.
    expect(out[0]?.fields[0]?.to).toBeUndefined();
    expect(out[1]?.fields[0]?.to).toBeUndefined();
  });

  it("preserves the input order on output (newest-first stays newest-first)", () => {
    const entries: Entry[] = [
      { id: "newest", group: "g", when: "2026-04-15", state: { legal_name: "C" } },
      { id: "middle", group: "g", when: "2026-04-10", state: { legal_name: "B" } },
      { id: "oldest", group: "g", when: "2026-04-01", state: { legal_name: "A" } },
    ];
    const out = expandWithFieldDiffs({
      entries,
      groupKey: (e) => e.group,
      previousState: (e) => e.state,
      labels: () => labels,
      hiddenKeys,
    });
    expect(out.map((o) => o.entry.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("returns an empty array for empty input", () => {
    const out = expandWithFieldDiffs({
      entries: [] as Entry[],
      groupKey: (e) => e.group,
      previousState: (e) => e.state,
      labels: () => labels,
      hiddenKeys,
    });
    expect(out).toEqual([]);
  });

  it("supports per-entry labels (different tables in one timeline)", () => {
    const entries: Entry[] = [
      { id: "biz", group: "business:", when: "2026-04-15", state: { legal_name: "Acme LLC" } },
      { id: "reg", group: "registration:1", when: "2026-04-10", state: { state: "DE" } },
    ];
    const labelsByKind: Record<string, Record<string, string>> = {
      biz: { legal_name: "Legal name" },
      reg: { state: "State" },
    };
    const out = expandWithFieldDiffs({
      entries,
      groupKey: (e) => e.group,
      previousState: (e) => e.state,
      labels: (e) => labelsByKind[e.id] ?? {},
      hiddenKeys,
    });
    expect(out[0]?.fields.map((f) => f.label)).toEqual(["Legal name"]);
    expect(out[1]?.fields.map((f) => f.label)).toEqual(["State"]);
  });
});
