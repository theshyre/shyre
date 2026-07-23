import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_API_SCOPES, ALLOWED_STARTED_BY_KINDS } from "./allow-lists";

/**
 * The scopes CHECK is array-shaped (`scopes <@ ARRAY[...]::text[]`), which
 * the generic db-parity extractor (CHECK ... IN (...)) can't parse — so
 * parity for scopes is asserted here directly against the migrations.
 *
 * Latest-definition-wins: the CHECK + DEFAULT are widened by later migrations
 * (e.g. 20260723120000 added entries:read/entries:delete via ALTER), so we
 * assert against the EFFECTIVE literal — the last occurrence across
 * timestamp-sorted migrations — not the foundation file. started_by_kind uses
 * the standard IN shape and is covered by db-parity.test.ts.
 */
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Concatenate all migration SQL in timestamp order. */
function allMigrationsInOrder(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

/** The scopes from the LAST match of `re` across all migrations. */
function lastScopeList(re: RegExp): string[] {
  const sql = allMigrationsInOrder();
  const matches = [...sql.matchAll(re)];
  expect(matches.length).toBeGreaterThan(0);
  const last = matches[matches.length - 1]!;
  return [...last[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe("ALLOWED_API_SCOPES ↔ scopes CHECK parity", () => {
  it("matches the EFFECTIVE ARRAY literal in the scopes containment CHECK", () => {
    const dbScopes = lastScopeList(/scopes <@ ARRAY\[([^\]]+)\]::text\[\]/g);
    expect([...dbScopes].sort()).toEqual([...ALLOWED_API_SCOPES].sort());
  });

  it("matches the EFFECTIVE column DEFAULT (new tokens get every v1 scope)", () => {
    // Either the original column DEFAULT or a later ALTER COLUMN … SET DEFAULT.
    const defaults = lastScopeList(
      /(?:scopes\s+TEXT\[\] NOT NULL DEFAULT|ALTER COLUMN scopes SET DEFAULT) ARRAY\[([^\]]+)\]/g,
    );
    expect([...defaults].sort()).toEqual([...ALLOWED_API_SCOPES].sort());
  });

  it("reaches no table beyond timers/entries — the delete scope is entries-only", () => {
    // The security invariant is scope SHAPE, not the absence of delete: every
    // scope is (context|timer|entries):(read|write|delete), so no
    // invoice/customer/settings capability can slip in. entries:delete is the
    // one deliberately-added destructive scope (soft-delete, agent rows only).
    for (const scope of ALLOWED_API_SCOPES) {
      expect(scope).toMatch(/^(context|timer|entries):(read|write|delete)$/);
    }
    // delete is confined to entries — never timers or context.
    expect(ALLOWED_API_SCOPES.has("timer:delete")).toBe(false);
    expect(ALLOWED_API_SCOPES.has("context:delete")).toBe(false);
    expect(ALLOWED_API_SCOPES.has("entries:delete")).toBe(true);
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
