import { describe, it, expect } from "vitest";
import {
  appendBlankSplit,
  autoBalanceLastSplit,
  initialSplitState,
  removeSplitAt,
  summarizeSplitDiff,
  totalSplitCents,
  validateSplits,
  type ExpenseSplit,
} from "./split-helpers";

describe("validateSplits", () => {
  it("requires at least two splits", () => {
    const res = validateSplits(100, [
      { amount: 100, category: "office" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/at least two parts/i);
  });

  it("accepts two splits that sum exactly", () => {
    const splits: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 70, category: "office" },
    ];
    const res = validateSplits(100, splits);
    expect(res.ok).toBe(true);
    expect(res.summary).toBeNull();
  });

  it("rejects when sum differs from original by more than 2¢", () => {
    const res = validateSplits(100, [
      { amount: 50, category: "office" },
      { amount: 49, category: "meals" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/sum/i);
  });

  it("accepts within 2¢ tolerance for rounding wobble", () => {
    // 33.33 + 33.33 + 33.33 = 99.99 — 1 cent under
    const res = validateSplits(100, [
      { amount: 33.33, category: "office" },
      { amount: 33.33, category: "meals" },
      { amount: 33.33, category: "software" },
    ]);
    expect(res.ok).toBe(true);
  });

  it("flags individual zero or negative amounts", () => {
    const res = validateSplits(100, [
      { amount: 50, category: "office" },
      { amount: 0, category: "meals" },
      { amount: 50, category: "software" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.perSplit[1]).toMatch(/greater than zero/i);
  });

  it("flags individual unknown categories", () => {
    const res = validateSplits(100, [
      { amount: 50, category: "office" },
      { amount: 50, category: "bogus_cat" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.perSplit[1]).toMatch(/valid category/i);
  });

  it("does not show sum-mismatch when individual rows are invalid", () => {
    const res = validateSplits(100, [
      { amount: 50, category: "office" },
      { amount: 0, category: "meals" }, // zero → individual error
    ]);
    expect(res.ok).toBe(false);
    expect(res.summary).toBeNull(); // suppressed when per-row errors exist
  });
});

describe("totalSplitCents", () => {
  it("returns 0 for empty splits", () => {
    expect(totalSplitCents([])).toBe(0);
  });

  it("sums in cents to avoid float drift", () => {
    expect(
      totalSplitCents([
        { amount: 0.1, category: "office" },
        { amount: 0.2, category: "meals" },
      ]),
    ).toBe(30);
  });

  it("ignores non-finite amounts", () => {
    expect(
      totalSplitCents([
        { amount: 50, category: "office" },
        { amount: Number.NaN, category: "meals" },
      ]),
    ).toBe(5000);
  });
});

describe("autoBalanceLastSplit", () => {
  it("returns the input unchanged when it already balances", () => {
    const splits: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 70, category: "office" },
    ];
    const out = autoBalanceLastSplit(100, splits);
    expect(out).toEqual(splits);
  });

  it("adjusts the last split to absorb the difference", () => {
    const splits: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 50, category: "office" }, // sum 80, need +20
    ];
    const out = autoBalanceLastSplit(100, splits);
    expect(out).not.toBeNull();
    expect(out!.at(-1)?.amount).toBe(70);
  });

  it("refuses to make the last split <= 0", () => {
    const splits: ExpenseSplit[] = [
      { amount: 80, category: "office" },
      { amount: 50, category: "meals" }, // sum 130, need -30 → last would be 20
    ];
    // 130 - 30 = 100. Last split goes from 50 → 20, which is fine.
    expect(autoBalanceLastSplit(100, splits)?.at(-1)?.amount).toBe(20);

    // But: original 50, splits sum to 200 → need to take 150 out
    // of the last split (50) → would zero it out. Refuse.
    expect(
      autoBalanceLastSplit(50, [
        { amount: 100, category: "office" },
        { amount: 100, category: "meals" },
      ]),
    ).toBeNull();
  });

  it("returns null on empty splits", () => {
    expect(autoBalanceLastSplit(100, [])).toBeNull();
  });
});

describe("summarizeSplitDiff", () => {
  it("balanced: diff 0, label null, isBalanced true", () => {
    const splits: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 70, category: "office" },
    ];
    const out = summarizeSplitDiff(100, splits);
    expect(out.diffCents).toBe(0);
    expect(out.label).toBeNull();
    expect(out.isBalanced).toBe(true);
    expect(out.isOver).toBe(false);
  });

  it("over: positive diff, +-prefixed label", () => {
    const splits: ExpenseSplit[] = [
      { amount: 60, category: "meals" },
      { amount: 70, category: "office" },
    ];
    const out = summarizeSplitDiff(100, splits);
    expect(out.diffCents).toBe(3000);
    expect(out.label).toBe("+30.00");
    expect(out.isOver).toBe(true);
    expect(out.isBalanced).toBe(false);
  });

  it("under: negative diff, signed label", () => {
    const splits: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 50, category: "office" },
    ];
    const out = summarizeSplitDiff(100, splits);
    expect(out.diffCents).toBe(-2000);
    expect(out.label).toBe("-20.00");
    expect(out.isOver).toBe(false);
    expect(out.isBalanced).toBe(false);
  });

  it("within tolerance: 1¢ off counts as balanced", () => {
    const splits: ExpenseSplit[] = [
      { amount: 33.33, category: "meals" },
      { amount: 33.33, category: "office" },
      { amount: 33.33, category: "software" },
    ];
    const out = summarizeSplitDiff(100, splits);
    expect(out.isBalanced).toBe(true);
    expect(out.label).toBe("-0.01"); // still shown so user knows it's not exact
  });
});

describe("initialSplitState", () => {
  it("splits an even amount in half preserving the category + notes on the first", () => {
    const out = initialSplitState({
      originalAmount: 100,
      originalCategory: "office",
      originalNotes: "Costco run",
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      amount: 50,
      category: "office",
      notes: "Costco run",
    });
    expect(out[1]).toEqual({
      amount: 50,
      category: "other",
      notes: null,
    });
  });

  it("absorbs odd cents into the second half so the splits sum exactly", () => {
    const out = initialSplitState({
      originalAmount: 100.01,
      originalCategory: "office",
      originalNotes: null,
    });
    // 10001 cents / 2 = 5000.5 → 5000 + 5001
    expect(out[0]?.amount).toBe(50);
    expect(out[1]?.amount).toBe(50.01);
    expect(totalSplitCents(out)).toBe(10001);
  });

  it("preserves null notes", () => {
    const out = initialSplitState({
      originalAmount: 100,
      originalCategory: "software",
      originalNotes: null,
    });
    expect(out[0]?.notes).toBeNull();
  });
});

describe("appendBlankSplit", () => {
  it("adds a blank split with category=other", () => {
    const initial: ExpenseSplit[] = [
      { amount: 50, category: "office" },
      { amount: 50, category: "meals" },
    ];
    const out = appendBlankSplit(initial);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ amount: 0, category: "other", notes: null });
  });

  it("does not mutate the input", () => {
    const initial: ExpenseSplit[] = [
      { amount: 50, category: "office" },
      { amount: 50, category: "meals" },
    ];
    appendBlankSplit(initial);
    expect(initial).toHaveLength(2);
  });
});

describe("removeSplitAt", () => {
  it("removes the split at the given index", () => {
    const initial: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 30, category: "office" },
      { amount: 40, category: "software" },
    ];
    const out = removeSplitAt(initial, 1);
    expect(out).toHaveLength(2);
    expect(out[0]?.category).toBe("meals");
    expect(out[1]?.category).toBe("software");
  });

  it("refuses to remove when length would drop below 2", () => {
    const initial: ExpenseSplit[] = [
      { amount: 50, category: "office" },
      { amount: 50, category: "meals" },
    ];
    const out = removeSplitAt(initial, 0);
    expect(out).toHaveLength(2);
  });

  it("ignores out-of-range indices", () => {
    const initial: ExpenseSplit[] = [
      { amount: 30, category: "meals" },
      { amount: 30, category: "office" },
      { amount: 40, category: "software" },
    ];
    expect(removeSplitAt(initial, -1)).toHaveLength(3);
    expect(removeSplitAt(initial, 10)).toHaveLength(3);
  });
});
