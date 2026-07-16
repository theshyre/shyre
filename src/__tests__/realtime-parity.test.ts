/**
 * Parity check: the set of tables the module registry declares as
 * `realtimeTables` must exactly match the tables that carry the
 * `broadcast_team_change` trigger in the migrations.
 *
 * Failure here means the shell's <RealtimeTeamSignal> and the database have
 * drifted — either a module claims live updates for a table with no trigger
 * (silent no-op: the "PostgREST silently fails" class of bug), or a trigger
 * fires Broadcasts nobody is authorized to hear. Mirrors the ALLOWED_* ↔
 * CHECK-constraint discipline in `db-parity.test.ts`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { realtimeWatchedTables } from "@/lib/modules/registry";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

/**
 * Tables with a `CREATE TRIGGER … AFTER … ON <table> … EXECUTE FUNCTION
 * public.broadcast_team_change`. Anchoring on `AFTER` excludes the paired
 * `DROP TRIGGER` lines; anchoring on the function name excludes unrelated
 * triggers.
 */
function triggeredTables(sql: string): string[] {
  // `[^;]*?` keeps each match inside a single statement — otherwise the lazy
  // gap would leap from an unrelated `CREATE TRIGGER … ON auth.users …` in an
  // earlier migration all the way down to our function name.
  const re =
    /CREATE\s+TRIGGER\s+\w+\s+AFTER[^;]*?\bON\s+(?:public\.)?(\w+)[^;]*?EXECUTE\s+FUNCTION\s+public\.broadcast_team_change/gi;
  const tables = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    if (match[1]) tables.add(match[1]);
  }
  return [...tables].sort();
}

describe("realtime broadcast parity", () => {
  it("registry realtimeTables exactly match the DB broadcast triggers", () => {
    const declared = realtimeWatchedTables();
    const triggered = triggeredTables(readMigrationsSql());
    expect(triggered).toEqual(declared);
  });

  it("declares at least one watched table", () => {
    expect(realtimeWatchedTables().length).toBeGreaterThan(0);
  });
});
