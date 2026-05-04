/**
 * Parity check: every ALLOWED_* constant in the app must match the CHECK
 * constraint on its corresponding DB column.
 *
 * Failure here means the app and the DB are out of sync — either the
 * app rejects a value the DB would accept (minor), or the DB rejects a
 * value the app tries to write (the bug that hid the sample-data incident:
 * app offered 'warm' theme, DB constraint hadn't been widened yet).
 *
 * The extractor walks migrations in lexical order and, for each known
 * (table, column) pair, records the values from every `CHECK ... IN (...)`
 * clause that mentions the column. The LAST occurrence wins — mirroring
 * DROP-then-ADD CONSTRAINT workflows.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  ALLOWED_THEMES,
  ALLOWED_LOCALES,
  ALLOWED_WEEK_STARTS,
  ALLOWED_TEXT_SIZES,
  ALLOWED_TIME_FORMATS,
} from "@/app/(dashboard)/profile/allow-lists";
import {
  ALLOWED_ENTITY_TYPES,
  ALLOWED_AFFILIATION_ROLES,
} from "@/app/(dashboard)/business/allow-lists";
import { ALLOWED_EXPENSE_CATEGORIES } from "@/app/(dashboard)/business/[businessId]/expenses/allow-lists";
import {
  ALLOWED_REGISTRATION_TYPES,
  ALLOWED_REGISTRATION_STATUSES,
  ALLOWED_REPORT_FREQUENCIES,
  ALLOWED_DUE_RULES,
  ALLOWED_TAX_TYPES,
  ALLOWED_TAX_REGISTRATION_STATUSES,
  ALLOWED_FILING_FREQUENCIES,
} from "@/app/(dashboard)/business/registrations-allow-lists";
import {
  ALLOWED_EMPLOYMENT_TYPES,
  ALLOWED_COMPENSATION_TYPES,
  ALLOWED_COMPENSATION_SCHEDULES,
} from "@/app/(dashboard)/business/people-allow-lists";
import { ALLOWED_INVOICE_GROUPING_MODES } from "@/app/(dashboard)/invoices/allow-lists";
import {
  ALLOWED_OUTBOX_STATUS,
  ALLOWED_RELATED_KINDS,
  ALLOWED_DOMAIN_STATUS,
} from "@/lib/messaging/allow-lists";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigrationsInOrder(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

/**
 * Find the LAST CHECK ... IN (...) clause in the concatenated SQL that
 * mentions the given column name. Returns the set of string literals, or
 * null if no constraint was found.
 *
 * Handles three shapes:
 *   CHECK (col IN ('a','b'))
 *   CHECK (col IS NULL OR col IN ('a','b'))
 *   col TEXT CHECK (col IN (...))   (inline in CREATE TABLE)
 *
 * `table`, when given, scopes the search to the body of that CREATE
 * TABLE statement — necessary when multiple tables share a column
 * name (`status` lives on projects, invoices, import_runs,
 * verified_email_domains, AND message_outbox; without scoping the
 * test would compare every status-bearing app set against the
 * latest-defined CHECK only).
 */
function extractCheckValues(
  sql: string,
  column: string,
  table?: string,
): Set<string> | null {
  // Narrow to the table's CREATE TABLE body when a table is given.
  // The body runs from `CREATE TABLE [IF NOT EXISTS] [schema.]table (`
  // to the matching closing `);`. Matching a balanced paren in regex
  // is gnarly, so we walk the string after the open paren counting
  // depth and stop at the close — same algorithm Postgres' own
  // tokenizer uses, just simpler.
  let scoped = sql;
  if (table) {
    const headerRe = new RegExp(
      String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?` +
        table +
        String.raw`\s*\(`,
      "i",
    );
    const headerMatch = headerRe.exec(sql);
    if (!headerMatch) return null;
    let depth = 1;
    let i = headerMatch.index + headerMatch[0].length;
    const start = i;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    scoped = sql.slice(start, i - 1);
  }
  const pattern = new RegExp(
    String.raw`CHECK\s*\(\s*(?:[^()]*?\b)` +
      column +
      String.raw`\b[^()]*?\bIN\s*\(\s*((?:'[^']*'\s*,?\s*)+)\s*\)\s*\)`,
    "gi",
  );
  let lastMatch: RegExpExecArray | null = null;
  for (const m of scoped.matchAll(pattern)) lastMatch = m as RegExpExecArray;
  if (!lastMatch) return null;
  const values = lastMatch[1]!.match(/'([^']*)'/g)!.map((s) =>
    s.slice(1, -1),
  );
  return new Set(values);
}

interface Pair {
  name: string;
  appSet: Set<string>;
  column: string;
  /** Optional CREATE TABLE name to disambiguate when multiple
   *  tables share a column name (`status` is the canonical
   *  example — see `extractCheckValues`). */
  table?: string;
}

const PAIRS: Pair[] = [
  { name: "themes", appSet: ALLOWED_THEMES, column: "preferred_theme" },
  { name: "locales", appSet: ALLOWED_LOCALES, column: "locale" },
  { name: "weekStarts", appSet: ALLOWED_WEEK_STARTS, column: "week_start" },
  { name: "textSizes", appSet: ALLOWED_TEXT_SIZES, column: "text_size" },
  { name: "timeFormats", appSet: ALLOWED_TIME_FORMATS, column: "time_format" },
  { name: "entityTypes", appSet: ALLOWED_ENTITY_TYPES, column: "entity_type" },
  {
    name: "expenseCategories",
    appSet: ALLOWED_EXPENSE_CATEGORIES,
    column: "category",
  },
  {
    name: "affiliationRoles",
    appSet: ALLOWED_AFFILIATION_ROLES,
    column: "affiliation_role",
  },
  {
    name: "registrationTypes",
    appSet: ALLOWED_REGISTRATION_TYPES,
    column: "registration_type",
  },
  {
    name: "registrationStatuses",
    appSet: ALLOWED_REGISTRATION_STATUSES,
    column: "registration_status",
  },
  {
    name: "reportFrequencies",
    appSet: ALLOWED_REPORT_FREQUENCIES,
    column: "report_frequency",
  },
  { name: "dueRules", appSet: ALLOWED_DUE_RULES, column: "due_rule" },
  { name: "taxTypes", appSet: ALLOWED_TAX_TYPES, column: "tax_type" },
  {
    name: "taxRegistrationStatuses",
    appSet: ALLOWED_TAX_REGISTRATION_STATUSES,
    column: "tax_registration_status",
  },
  {
    name: "filingFrequencies",
    appSet: ALLOWED_FILING_FREQUENCIES,
    column: "filing_frequency",
  },
  {
    name: "employmentTypes",
    appSet: ALLOWED_EMPLOYMENT_TYPES,
    column: "employment_type",
  },
  {
    name: "compensationTypes",
    appSet: ALLOWED_COMPENSATION_TYPES,
    column: "compensation_type",
  },
  {
    name: "compensationSchedules",
    appSet: ALLOWED_COMPENSATION_SCHEDULES,
    column: "compensation_schedule",
  },
  {
    name: "invoiceGroupingModes",
    appSet: ALLOWED_INVOICE_GROUPING_MODES,
    column: "grouping_mode",
  },
  // Messaging allow-list ↔ CHECK parity: catches drift between the
  // TS unions used by callers (OutboxStatus, RelatedKind) and the
  // CHECK constraints on message_outbox / verified_email_domains.
  // `status` is shared across multiple tables; table scoping is
  // required to compare each app set against the right CHECK.
  {
    name: "outboxStatus",
    appSet: new Set(ALLOWED_OUTBOX_STATUS),
    column: "status",
    table: "message_outbox",
  },
  {
    name: "relatedKinds",
    appSet: new Set(ALLOWED_RELATED_KINDS),
    column: "related_kind",
    table: "message_outbox",
  },
  {
    name: "domainStatus",
    appSet: new Set(ALLOWED_DOMAIN_STATUS),
    column: "status",
    table: "verified_email_domains",
  },
];

describe("DB parity", () => {
  const sql = readMigrationsInOrder();

  for (const pair of PAIRS) {
    it(`${pair.name}: ALLOWED_* matches the CHECK constraint on ${pair.column}`, () => {
      const dbSet = extractCheckValues(sql, pair.column, pair.table);
      expect(
        dbSet,
        `No CHECK ... ${pair.column} IN (...) found in migrations${
          pair.table ? ` for table ${pair.table}` : ""
        }`,
      ).not.toBeNull();
      // Compare set contents — order-independent, duplicates collapsed.
      expect(
        [...dbSet!].sort(),
        `DB check for ${pair.column} and app ALLOWED_${pair.name.toUpperCase()} drifted`,
      ).toEqual([...pair.appSet].sort());
    });
  }
});
