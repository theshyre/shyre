import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `*_v` view parity (batch 5): a Postgres view's column list is FROZEN at
 * creation — `ADD COLUMN` on the base table does NOT flow through. The
 * customers.accent_color/logo_url incident (added 20260717150000, view only
 * refreshed 20260717210000) shipped a customer-edit form that silently read
 * NULL branding. Rule (docs/reference/migrations.md): ADD COLUMN on a table
 * with a `*_v` view ⇒ CREATE OR REPLACE VIEW in the same migration.
 *
 * This test enforces the rule textually, no DB needed:
 *   1. find the LATEST migration that (re)creates `public.customers_v` and
 *      take the LAST definition in that file;
 *   2. collect every column later `ALTER TABLE customers ADD COLUMN`
 *      migrations add (same-file additions count — the view refresh must
 *      include them);
 *   3. assert each added column is selected by the view (or deliberately
 *      masked below). Columns added BEFORE the latest view refresh are the
 *      author's explicit column-list choice and are not re-litigated here.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Columns intentionally hidden from customers_v. None today — add a column
 *  here ONLY with a comment explaining why it must not surface on the view. */
const MASKED_CUSTOMERS_V_COLUMNS = new Set<string>([]);

/** Migration files sorted by their leading timestamp (filename order). */
function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
    }));
}

const VIEW_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.customers_v\b[\s\S]*?;/gi;

/** The latest `CREATE [OR REPLACE] VIEW public.customers_v` statement and the
 *  filename it lives in. */
function latestViewDefinition(): { file: string; statement: string } {
  for (const { name, sql } of [...migrationFiles()].reverse()) {
    const matches = [...sql.matchAll(VIEW_RE)];
    const last = matches[matches.length - 1];
    if (last) return { file: name, statement: last[0] };
  }
  throw new Error("No customers_v definition found in supabase/migrations");
}

/** Base-table columns the view selects: every `c.<col>` reference (the view
 *  aliases customers AS c; expression-wrapped columns like the rate-gated
 *  CASE still appear as `c.default_rate`). */
function viewSelectedColumns(statement: string): Set<string> {
  return new Set(
    [...statement.matchAll(/\bc\.([a-z_]+)/gi)].map((m) => {
      const column = m[1];
      if (!column) throw new Error("unreachable: empty capture");
      return column.toLowerCase();
    }),
  );
}

/** Columns added to `customers` by ADD COLUMN statements in migrations at or
 *  after `sinceFile` (filename order = timestamp order). Word-boundary match
 *  keeps `customer_contacts` et al. out. */
function columnsAddedSince(sinceFile: string): Map<string, string> {
  const added = new Map<string, string>(); // column -> migration file
  for (const { name, sql } of migrationFiles()) {
    if (name < sinceFile) continue;
    // Statement-wise scan: an ALTER TABLE may carry several ADD COLUMN clauses.
    for (const statement of sql.split(";")) {
      if (!/ALTER\s+TABLE\s+(?:public\.)?customers\b/i.test(statement)) continue;
      for (const m of statement.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_]+)"?/gi,
      )) {
        const column = m[1];
        if (column) added.set(column.toLowerCase(), name);
      }
    }
  }
  return added;
}

describe("customers_v view parity", () => {
  const { file, statement } = latestViewDefinition();
  const selected = viewSelectedColumns(statement);

  it("parser sanity: the latest definition selects the known column set", () => {
    // Guards the regexes themselves — if parsing silently broke, the parity
    // assertion below would pass vacuously.
    for (const column of ["id", "name", "default_rate", "accent_color", "logo_url"]) {
      expect(selected.has(column), `expected customers_v to select ${column}`).toBe(true);
    }
    expect(selected.size).toBeGreaterThanOrEqual(15);
  });

  it("every customers column added at/after the latest view refresh is surfaced (or masked)", () => {
    const added = columnsAddedSince(file);
    const missing = [...added.entries()].filter(
      ([column]) =>
        !selected.has(column) && !MASKED_CUSTOMERS_V_COLUMNS.has(column),
    );
    expect(
      missing,
      `customers_v (last refreshed in ${file}) is missing columns added by later migrations: ` +
        missing.map(([c, f]) => `${c} (${f})`).join(", ") +
        ". ADD COLUMN on customers must CREATE OR REPLACE customers_v in the same migration " +
        "(or mask the column in MASKED_CUSTOMERS_V_COLUMNS with a rationale).",
    ).toEqual([]);
  });

  it("masked-column list only contains real exclusions", () => {
    // A masked column that the view actually selects is stale masking.
    for (const column of MASKED_CUSTOMERS_V_COLUMNS) {
      expect(selected.has(column), `masked column ${column} is selected by the view`).toBe(false);
    }
  });
});
