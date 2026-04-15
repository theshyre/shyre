/**
 * Expense categories — must match the CHECK constraint on
 * public.expenses.category in 20260414230000_expenses.sql.
 */
export const EXPENSE_CATEGORIES = [
  "software",
  "hardware",
  "subscriptions",
  "travel",
  "meals",
  "office",
  "professional_services",
  "fees",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
