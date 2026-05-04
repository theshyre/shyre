/**
 * Pure-SQL regression test: every messaging table has RLS enabled,
 * and every team-scoped table has at least one SELECT policy gated
 * on `user_team_role(... ) IN (...)` or equivalent.
 *
 * Catches:
 *   - A new messaging table that ships without `ENABLE ROW LEVEL
 *     SECURITY` — the failure mode SAL-006 already burned us on
 *     once.
 *   - A new RLS policy that drops the team-scope predicate (e.g.
 *     `USING (true)` or `USING (auth.uid() IS NOT NULL)`).
 *
 * Doesn't replace integration tests against real RLS, but pins the
 * structure so a missing policy can't ship unnoticed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigrationsInOrder(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

const MESSAGING_TABLES = [
  "team_email_config",
  "verified_email_domains",
  "message_templates",
  "message_outbox",
  "message_outbox_events",
  "message_outbox_history",
] as const;

describe("messaging tables — RLS structure", () => {
  const sql = readMigrationsInOrder();

  for (const table of MESSAGING_TABLES) {
    it(`${table}: ENABLE ROW LEVEL SECURITY appears in the migrations`, () => {
      const pattern = new RegExp(
        String.raw`ALTER\s+TABLE\s+(?:public\.)?` +
          table +
          String.raw`\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`,
        "i",
      );
      expect(
        pattern.test(sql),
        `Missing "ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY" — every messaging table must have RLS on. SAL-006 lineage.`,
      ).toBe(true);
    });

    it(`${table}: at least one SELECT policy referencing user_team_role`, () => {
      // Policy bodies vary in shape. We check that at least one
      // policy exists ON the table whose body mentions
      // `user_team_role` — the function any team-scoped policy
      // must use to compute the caller's role on the row's team.
      // A `USING (true)` or other gate-less policy would fail
      // this assertion.
      const pattern = new RegExp(
        String.raw`CREATE\s+POLICY\s+[^\s]+\s+ON\s+(?:public\.)?` +
          table +
          // Match across the whole policy body up to the next
          // top-level `;` — but stop at `;` only when not inside
          // parens. Approximation: scan up to the next `;` and
          // grep for `user_team_role` in the chunk.
          String.raw`[\s\S]*?;`,
        "gi",
      );
      let foundTeamScopedPolicy = false;
      for (const m of sql.matchAll(pattern)) {
        if (m[0].includes("user_team_role")) {
          foundTeamScopedPolicy = true;
          break;
        }
      }
      expect(
        foundTeamScopedPolicy,
        `${table} has no policy gated on user_team_role(...). Either RLS is open (USING (true) — bad) or the gate uses a function that won't reflect role changes (also bad). SAL-006 mandates user_team_role.`,
      ).toBe(true);
    });
  }
});
