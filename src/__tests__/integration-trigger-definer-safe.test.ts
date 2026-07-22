/**
 * SAL-058 regression guard — the app-role write-lock triggers on
 * `integration_tokens` and `time_entries` must be SECURITY-DEFINER-safe.
 *
 * These `BEFORE UPDATE` triggers exist to stop direct app-role
 * (`authenticated` / `anon`) PostgREST writes from mutating locked columns
 * (token rate-window bookkeeping; time-entry attribution). They must NOT fire
 * on the `SECURITY DEFINER` `api_*` RPCs' OWN writes: `api_resolve_token`
 * UPDATEs `window_count` / `last_used_at` on every call, and the tokens
 * trigger is default-DENY (SAL-055), so a trigger that fires there raises
 * `TK001` → un-mapped in the route layer's `ERRCODE_MAP` → **HTTP 500 on every
 * real-token API call** (the 2026-07-21 incident).
 *
 * The distinguishing signal MUST be `current_user` — the EFFECTIVE role, which
 * is the function OWNER inside a `SECURITY DEFINER` function and an app role
 * for a direct write. It must NOT be `current_setting('role')`: that is the
 * request-level GUC PostgREST sets to `'anon'`, and `SECURITY DEFINER` does
 * not change it, so it still reads `'anon'` inside the RPC and the guard
 * misfires on the RPC's own bookkeeping.
 *
 * No real DB in CI (per testing-roadmap), so this is enforced textually,
 * latest-definition-wins (mirrors `view-parity.test.ts`): a migration's
 * `CREATE TRIGGER` supersedes any earlier one, so we assert on the LAST
 * definition across timestamp-sorted migrations.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Every migration's SQL, in filename (timestamp) order. */
function migrationsSqlInOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

/**
 * The effective (latest-applied) `CREATE TRIGGER <name> … EXECUTE FUNCTION …;`
 * statement across all migrations, or `null` if the trigger is never created.
 * `DROP TRIGGER IF EXISTS <name>` and the `tg_<name>` function definition do
 * not match — only the `CREATE TRIGGER` statement does.
 */
function latestCreateTrigger(name: string): string | null {
  const re = new RegExp(
    `CREATE TRIGGER\\s+${name}\\b[\\s\\S]*?EXECUTE FUNCTION[^;]*;`,
    "g",
  );
  let last: string | null = null;
  for (const sql of migrationsSqlInOrder()) {
    const matches = sql.match(re);
    if (matches && matches.length > 0) last = matches[matches.length - 1] ?? last;
  }
  return last;
}

/** Both triggers whose sole job is to lock columns against direct app-role
 *  writes — the class that must never fire on the definer RPCs' own writes. */
const APP_ROLE_WRITE_LOCK_TRIGGERS = [
  "integration_tokens_revoke_only",
  "time_entries_attribution_lock",
] as const;

describe("SAL-058 — app-role write-lock triggers are SECURITY-DEFINER-safe", () => {
  for (const trigger of APP_ROLE_WRITE_LOCK_TRIGGERS) {
    describe(trigger, () => {
      const block = latestCreateTrigger(trigger);

      it("is created by a migration", () => {
        expect(block).not.toBeNull();
      });

      it("gates on current_user (the effective role) so the definer RPCs bypass", () => {
        expect(block).toMatch(/WHEN\s*\(\s*current_user\b/);
      });

      it("does NOT gate on current_setting('role') — SECURITY DEFINER leaves that GUC as 'anon'", () => {
        expect(block).not.toMatch(/current_setting\(\s*'role'/);
      });
    });
  }
});
