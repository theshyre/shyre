import { describe, it, expect } from "vitest";
import { computeFieldDiff } from "@/lib/history/format";
import { FIELD_LABELS, HIDDEN_KEYS } from "./history-format";

/**
 * These tests exercise the generic `computeFieldDiff` mechanics
 * against the `business_people` FIELD_LABELS / HIDDEN_KEYS domain
 * data specifically — confirming the two stay wired together
 * correctly. Generic diff-mechanics tests (independent of any one
 * table's labels) live in `src/lib/history/format.test.ts`.
 */
describe("computeFieldDiff with business_people FIELD_LABELS/HIDDEN_KEYS", () => {
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
      { labels: FIELD_LABELS, hiddenKeys: HIDDEN_KEYS },
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
      { labels: FIELD_LABELS, hiddenKeys: HIDDEN_KEYS },
    );
    expect(diff.map((d) => d.key)).toEqual(["compensation_amount_cents"]);
    expect(diff[0]!.from).toBe(8500000);
    expect(diff[0]!.to).toBe(6000000);
  });

  it("treats null vs missing-key as different (the move surfaces in audit)", () => {
    const diff = computeFieldDiff(
      { ended_on: null },
      { ended_on: "2026-04-01" },
      { labels: FIELD_LABELS, hiddenKeys: HIDDEN_KEYS },
    );
    expect(diff.map((d) => d.key)).toContain("ended_on");
  });

  it("returns an empty diff when the two snapshots are equivalent", () => {
    const diff = computeFieldDiff(
      { legal_name: "Robert Smith", title: "CEO" },
      { legal_name: "Robert Smith", title: "CEO" },
      { labels: FIELD_LABELS, hiddenKeys: HIDDEN_KEYS },
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
      { labels: FIELD_LABELS, hiddenKeys: HIDDEN_KEYS },
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
      { labels: FIELD_LABELS, hiddenKeys: HIDDEN_KEYS },
    );
    for (const key of HIDDEN_KEYS) {
      expect(diff.map((d) => d.key)).not.toContain(key);
    }
    expect(diff.map((d) => d.key)).toContain("legal_name");
  });
});
