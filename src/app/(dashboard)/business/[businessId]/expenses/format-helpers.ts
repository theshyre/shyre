/**
 * @deprecated Moved to `@/lib/expenses/format-helpers` during the
 * phase-3 project-page restructure so cross-module callers (project
 * pages, invoice line-item formatting) don't have to import out of
 * another module's directory. This file re-exports for in-flight
 * callers that haven't been updated yet — new code should import
 * from `@/lib/expenses/format-helpers` directly.
 */

export {
  formatExpenseAmount,
  formatExpenseDateDisplay,
  humanizeExpenseCategory,
} from "@/lib/expenses/format-helpers";
