import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_API_SCOPES, ALLOWED_STARTED_BY_KINDS } from "./allow-lists";

/**
 * The scopes CHECK is array-shaped (`scopes <@ ARRAY[...]::text[]`), which
 * the generic db-parity extractor (CHECK ... IN (...)) can't parse — so
 * parity for scopes is asserted here directly against the migration.
 * started_by_kind uses the standard IN shape and is covered by
 * db-parity.test.ts; this file just pins the app-side set contents.
 */
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260718150000_integrations_foundation.sql",
  ),
  "utf8",
);

describe("ALLOWED_API_SCOPES ↔ scopes CHECK parity", () => {
  it("matches the ARRAY literal in the scopes containment CHECK", () => {
    const m = MIGRATION.match(
      /scopes <@ ARRAY\[([^\]]+)\]::text\[\]/,
    );
    expect(m).not.toBeNull();
    const dbScopes = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...dbScopes].sort()).toEqual([...ALLOWED_API_SCOPES].sort());
  });

  it("matches the column DEFAULT (new tokens get every v1 scope)", () => {
    const m = MIGRATION.match(/scopes\s+TEXT\[\] NOT NULL DEFAULT ARRAY\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const defaults = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...defaults].sort()).toEqual([...ALLOWED_API_SCOPES].sort());
  });

  it("contains no write scope beyond timers/entries (no delete, no invoices)", () => {
    for (const scope of ALLOWED_API_SCOPES) {
      expect(scope).toMatch(/^(context|timer|entries):(read|write)$/);
    }
    expect(ALLOWED_API_SCOPES.has("entries:delete")).toBe(false);
  });
});

describe("ALLOWED_STARTED_BY_KINDS", () => {
  it("is the Option B Phase 1 set", () => {
    expect([...ALLOWED_STARTED_BY_KINDS].sort()).toEqual([
      "agent",
      "import",
      "integration",
      "user",
    ]);
  });
});
