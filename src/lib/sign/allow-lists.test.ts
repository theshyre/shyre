import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SIGNOFF_DOCUMENT_TYPES,
  SIGNOFF_STATUSES,
  SIGNOFF_SIGNING_MODES,
  SIGNATURE_MEANINGS,
} from "./allow-lists";

/**
 * Parity against the CHECK constraints in the foundation migration. The
 * signoff enums use unique column names, but — like the integration scopes —
 * a dedicated test keeps app-set ↔ DB-CHECK in lockstep.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260723130000_signoff_foundation.sql"),
  "utf8",
);

/** The IN-list of the CHECK for `<column> ... IN ('a','b')`. */
function checkValues(column: string): string[] {
  const re = new RegExp(`${column}\\s+TEXT[^,]*?CHECK \\(${column} IN \\(([^)]+)\\)\\)`, "s");
  const m = MIGRATION.match(re);
  if (!m) throw new Error(`no CHECK found for column ${column}`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe("signoff allow-lists ↔ migration CHECK parity", () => {
  it.each([
    ["document_type", SIGNOFF_DOCUMENT_TYPES],
    ["status", SIGNOFF_STATUSES],
    ["signing_mode", SIGNOFF_SIGNING_MODES],
  ] as const)("%s matches its CHECK", (column, appSet) => {
    expect(checkValues(column).sort()).toEqual([...appSet].sort());
  });

  it("signature_meaning matches its (nullable) CHECK", () => {
    const m = MIGRATION.match(/signature_meaning IN \(([^)]+)\)/);
    expect(m).not.toBeNull();
    const dbValues = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    expect(dbValues.sort()).toEqual([...SIGNATURE_MEANINGS].sort());
  });
});
