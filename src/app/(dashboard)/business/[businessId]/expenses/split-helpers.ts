/**
 * Pure validation + math for the "Split this expense" flow.
 * Extracted so the modal's Save-disabled logic and the server
 * action's pre-write check share the same rules — and both are
 * unit-testable without mounting React or hitting Supabase.
 *
 * The single-category constraint is intentional (see the
 * expense-categories docs guide): tax exports want one bucket
 * per row, so a "split" is a multi-row decomposition of one
 * receipt total. This helper enforces that the parts sum to the
 * whole within rounding tolerance.
 */

import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";

export interface ExpenseSplit {
  /** Amount in the row's currency, two decimals. */
  amount: number;
  /** One of EXPENSE_CATEGORIES. */
  category: string;
  /** Optional per-split notes. The original row's notes are
   *  preserved on splits[0]; later splits start blank unless
   *  the user fills them in. */
  notes?: string | null;
}

/** Maximum acceptable difference between the sum of splits and
 *  the original amount. Two cents to absorb 1¢ rounding errors
 *  on each of two splits — anything beyond is the user's
 *  arithmetic mistake, not a floating-point artifact. */
export const SPLIT_SUM_TOLERANCE_CENTS = 2;

export interface SplitValidationResult {
  ok: boolean;
  /** Per-split error messages keyed by index. Empty when the
   *  split has no error of its own (sum-mismatch errors live
   *  at the top level instead). */
  perSplit: Record<number, string>;
  /** Summary error when the splits don't sum to the original
   *  amount, or when there are fewer than 2. Null when ok. */
  summary: string | null;
}

export function validateSplits(
  originalAmount: number,
  splits: readonly ExpenseSplit[],
): SplitValidationResult {
  const perSplit: Record<number, string> = {};

  if (splits.length < 2) {
    return {
      ok: false,
      perSplit,
      summary: "A split needs at least two parts. Use Edit if you only want to change the amount.",
    };
  }

  for (let i = 0; i < splits.length; i++) {
    const s = splits[i]!;
    if (!Number.isFinite(s.amount) || s.amount <= 0) {
      perSplit[i] = "Amount must be greater than zero.";
      continue;
    }
    if (!ALLOWED_EXPENSE_CATEGORIES.has(s.category)) {
      perSplit[i] = "Pick a valid category.";
      continue;
    }
  }

  // If any individual split is invalid, no point on top-level sum
  // check — the user is mid-edit, sum mismatch error would be
  // double-noise.
  if (Object.keys(perSplit).length > 0) {
    return { ok: false, perSplit, summary: null };
  }

  const splitsSumCents = splits.reduce(
    (acc, s) => acc + Math.round(s.amount * 100),
    0,
  );
  const originalCents = Math.round(originalAmount * 100);
  const diffCents = Math.abs(splitsSumCents - originalCents);
  if (diffCents > SPLIT_SUM_TOLERANCE_CENTS) {
    return {
      ok: false,
      perSplit,
      summary: `Splits sum to ${formatDollars(splitsSumCents)} but the original is ${formatDollars(originalCents)}.`,
    };
  }

  return { ok: true, perSplit, summary: null };
}

/** Compute the running total of split amounts in cents. Used by
 *  the modal's "Total: $X" line so the user can watch the sum
 *  approach (or exceed) the original as they type. */
export function totalSplitCents(splits: readonly ExpenseSplit[]): number {
  return splits.reduce((acc, s) => {
    if (!Number.isFinite(s.amount)) return acc;
    return acc + Math.round(s.amount * 100);
  }, 0);
}

/** "If the user pressed Save right now and we evenly redistributed
 *  the missing cents across the last split, what would each row
 *  end up at?" — used by the modal's "Auto-balance" button so
 *  near-correct splits don't need manual math.
 *
 *  Returns the splits unchanged when they already balance.
 *  Returns null when there's no last split to adjust into (zero
 *  splits) — the caller should refuse the auto-balance click in
 *  that case. */
export function autoBalanceLastSplit(
  originalAmount: number,
  splits: readonly ExpenseSplit[],
): ExpenseSplit[] | null {
  if (splits.length === 0) return null;
  const originalCents = Math.round(originalAmount * 100);
  const sumCents = totalSplitCents(splits);
  if (sumCents === originalCents) return splits.map((s) => ({ ...s }));

  const adjusted = splits.map((s) => ({ ...s }));
  const lastIdx = adjusted.length - 1;
  const lastCents = Math.round(adjusted[lastIdx]!.amount * 100);
  const newLastCents = lastCents + (originalCents - sumCents);
  if (newLastCents <= 0) {
    // Adjustment would zero or negate the last split — caller
    // should rebalance manually.
    return null;
  }
  adjusted[lastIdx]!.amount = newLastCents / 100;
  return adjusted;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface SplitDiffSummary {
  /** Signed diff in cents: splits sum minus original. Positive
   *  means splits over-allocate; negative means under. */
  diffCents: number;
  /** Display string for the diff, with +/- sign on non-zero
   *  values. Null when the diff is exactly zero (caller hides
   *  the diff line entirely in that case). */
  label: string | null;
  /** True iff the diff is within SPLIT_SUM_TOLERANCE_CENTS — UI
   *  should show the "balanced" state. */
  isBalanced: boolean;
  /** True iff splits sum to MORE than the original. */
  isOver: boolean;
}

/** Initial split state when the modal opens — two halves of the
 *  original. splits[0] preserves the original's category +
 *  notes; splits[1] starts as "other" with no notes. Pure so
 *  the modal's mount-time initialization stays test-friendly. */
export function initialSplitState(args: {
  originalAmount: number;
  originalCategory: string;
  originalNotes: string | null;
}): ExpenseSplit[] {
  // Use cents math so 100.00 → 50.00 / 50.00 cleanly. Odd-cent
  // amounts give 50.005 → second split absorbs the extra cent
  // (the leftover in originalCents - half).
  const originalCents = Math.round(args.originalAmount * 100);
  const halfCents = Math.floor(originalCents / 2);
  const remainder = originalCents - halfCents;
  return [
    {
      amount: halfCents / 100,
      category: args.originalCategory,
      notes: args.originalNotes,
    },
    {
      amount: remainder / 100,
      category: "other",
      notes: null,
    },
  ];
}

/** Append a new blank split. Pure — returns a fresh array. */
export function appendBlankSplit(
  splits: readonly ExpenseSplit[],
): ExpenseSplit[] {
  return [
    ...splits,
    { amount: 0, category: "other", notes: null },
  ];
}

/** Remove the split at the given index. Refuses to remove when
 *  doing so would leave fewer than two splits — splits with
 *  count < 2 are invalid (it's not a split anymore). */
export function removeSplitAt(
  splits: readonly ExpenseSplit[],
  index: number,
): ExpenseSplit[] {
  if (splits.length <= 2) return splits.slice();
  if (index < 0 || index >= splits.length) return splits.slice();
  return splits.filter((_, i) => i !== index);
}

/** Compute display data for the modal's "Total: $X of $Y / +0.30"
 *  status line. Pure so formatting + tolerance live in one
 *  tested place. */
export function summarizeSplitDiff(
  originalAmount: number,
  splits: readonly ExpenseSplit[],
): SplitDiffSummary {
  const sumCents = totalSplitCents(splits);
  const originalCents = Math.round(originalAmount * 100);
  const diffCents = sumCents - originalCents;
  const isBalanced = Math.abs(diffCents) <= SPLIT_SUM_TOLERANCE_CENTS;
  const isOver = diffCents > 0;
  const label =
    diffCents === 0
      ? null
      : (diffCents > 0 ? "+" : "") + (diffCents / 100).toFixed(2);
  return { diffCents, label, isBalanced, isOver };
}
