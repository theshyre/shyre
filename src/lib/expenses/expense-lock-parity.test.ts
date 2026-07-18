import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { INVOICED_EDITABLE_EXPENSE_FIELDS } from "./expense-lock-helpers";

/**
 * The field-aware invoice-lock has TWO enforcement points that MUST
 * agree: the TS `INVOICED_EDITABLE_EXPENSE_FIELDS` set (action layer +
 * UI) and the `meta` strip-list inside `tg_expenses_invoice_lock_guard`
 * (the authoritative DB boundary). If they drift, either a field the
 * UI offers gets rejected by the DB (broken UX) or — worse — a field
 * the DB allows isn't gated by the action (a hole). This test pins
 * them together, the same discipline db-parity.test.ts applies to
 * ALLOWED_* CHECK constraints.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

/**
 * Extract the `meta CONSTANT text[] := ARRAY[ ... ]` literal from the
 * lock-guard trigger. Last definition wins (mirrors CREATE OR REPLACE
 * supersession). Returns the set of string literals, or null if absent.
 */
function triggerMetaSet(sql: string): Set<string> | null {
  const re = /meta\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\s*\[([^\]]*)\]/gi;
  let last: RegExpExecArray | null = null;
  for (const m of sql.matchAll(re)) last = m as RegExpExecArray;
  if (!last) return null;
  const literals = last[1]!.match(/'([^']*)'/g);
  if (!literals) return null;
  return new Set(literals.map((s) => s.slice(1, -1)));
}

describe("expense invoice-lock field parity", () => {
  it("trigger `meta` strip-list matches INVOICED_EDITABLE_EXPENSE_FIELDS", () => {
    const meta = triggerMetaSet(migrationsSql());
    expect(
      meta,
      "could not find `meta CONSTANT text[] := ARRAY[...]` in migrations — did the lock trigger move?",
    ).not.toBeNull();
    expect([...meta!].sort()).toEqual(
      [...INVOICED_EDITABLE_EXPENSE_FIELDS].sort(),
    );
  });

  it("never lists a financial / lock column as editable-while-invoiced", () => {
    // Defense-in-depth assertion: even if both sides drift together,
    // these columns must NEVER be in the metadata set.
    for (const locked of [
      "amount",
      "currency",
      "incurred_on",
      "project_id",
      "billable",
      "invoiced",
      "invoice_id",
      "invoiced_at",
    ]) {
      expect(INVOICED_EDITABLE_EXPENSE_FIELDS.has(locked)).toBe(false);
    }
  });
});
