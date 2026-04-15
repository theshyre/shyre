/**
 * Allow-list for expenses.category. Mirrored by a CHECK constraint in
 * 20260414230000_expenses.sql. See src/__tests__/db-parity.test.ts.
 */
export const ALLOWED_EXPENSE_CATEGORIES = new Set([
  "software",
  "hardware",
  "subscriptions",
  "travel",
  "meals",
  "office",
  "professional_services",
  "fees",
  "other",
]);
