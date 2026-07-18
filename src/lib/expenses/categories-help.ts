/**
 * Resolver for per-category help text. The actual strings live in
 * the i18n bundles (`expenses.categoryHelp.<key>.{description,examples}`)
 * — this module just enforces the shape and provides one function
 * that reads them via next-intl's t() so React components don't
 * have to wire `t` calls per category at the call site.
 *
 * Two consumers today:
 *   - the New Expense form's category-hint helper text
 *   - the bulk-action category picker's per-item subtitle
 *
 * The docs guide at `docs/guides/features/expense-categories.md`
 * mirrors the same English source — keep them in sync if either
 * moves.
 *
 * Adding a new category means widening the CHECK constraint in
 * supabase migrations, EXPENSE_CATEGORIES, the allow-lists, and
 * the i18n bundles' `categoryHelp` block. db-parity.test
 * enforces constraint ↔ allow-list parity.
 */

import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./categories";

export interface CategoryHelp {
  /** One-line answer to "what kind of expense lives here?" */
  description: string;
  /** Concrete example list, comma-joined. Fits the user's
   *  recategorize flow ("Linode → which one?") better than
   *  abstract definitions alone. */
  examples: string;
}

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** Build the help object for a single category. */
export function getCategoryHelp(
  category: ExpenseCategory,
  t: Translator,
): CategoryHelp {
  return {
    description: t(`categoryHelp.${category}.description`),
    examples: t(`categoryHelp.${category}.examples`),
  };
}

/** Build help for every category in canonical order. Useful for
 *  rendering all-categories surfaces (the bulk picker, the docs
 *  page, etc.). */
export function getAllCategoryHelp(
  t: Translator,
): Array<{ category: ExpenseCategory } & CategoryHelp> {
  return EXPENSE_CATEGORIES.map((category) => ({
    category,
    ...getCategoryHelp(category, t),
  }));
}
