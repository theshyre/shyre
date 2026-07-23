/**
 * Smoke test on the project-default-category + API-categories migration
 * (`20260721140000`). No real DB in CI (per testing-roadmap), so this reads
 * the migration SQL and pins the invariants the feature depends on:
 *   - projects.default_category_id (FK, ON DELETE SET NULL);
 *   - api_list_projects embeds `categories` + `default_category_id`, using the
 *     base-OR-extension effective-set rule (mirrors validate_time_entry_category);
 *   - api_log_entry gains p_category_id, resolves COALESCE(explicit, project
 *     default), rejects an out-of-set explicit category (TK400) but drops a
 *     stale default to NULL, and INSERTs category_id;
 *   - api_log_entry stays anon-only (SAL-054: PUBLIC + authenticated revoked);
 *   - projects_v re-projects default_category_id (frozen-column rule).
 *
 * These assert the SQL an agent's category path relies on. If you reshape the
 * RPC, understand WHY a line fails before relaxing it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigration(substr: string): string {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .find((f) => f.endsWith(`_${substr}.sql`));
  if (!file) throw new Error(`migration named "_${substr}.sql" not found`);
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

/**
 * The effective (latest-applied) `CREATE OR REPLACE FUNCTION <name> … $$;`
 * across timestamp-sorted migrations (mirrors `latestCreateTrigger` in
 * integration-trigger-definer-safe.test.ts). api_log_entry has been
 * redefined five times in four days — invariants pinned to any single
 * migration file go stale on the next redefinition; these never do.
 */
function latestCreateFunction(name: string): string {
  // Terminator: the first line STARTING with `$$` (the dollar-quote
  // closer) — covers both `$$;` and `$$ LANGUAGE plpgsql …;` styles.
  // Body lines never start with `$$`.
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION ${name}\\s*\\([\\s\\S]*?\\n\\$\\$[^\\n]*;`,
    "g",
  );
  let last = "";
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const matches = readFileSync(join(MIGRATIONS_DIR, file), "utf8").match(re);
    if (matches && matches.length > 0) last = matches[matches.length - 1] ?? last;
  }
  if (!last) throw new Error(`no CREATE OR REPLACE FUNCTION ${name} found`);
  return last;
}

describe("project default category + API categories migration", () => {
  const sql = readMigration("project_default_category_and_api_categories");

  it("adds projects.default_category_id as an ON DELETE SET NULL FK", () => {
    expect(sql).toMatch(
      /ALTER TABLE projects[\s\S]*ADD COLUMN IF NOT EXISTS default_category_id UUID/,
    );
    expect(sql).toMatch(/REFERENCES categories\(id\) ON DELETE SET NULL/);
  });

  it("embeds categories + default in api_list_projects via the effective-set rule", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION api_list_projects/);
    expect(sql).toMatch(/'default_category_id', p\.default_category_id/);
    expect(sql).toMatch(/'is_default', cat\.id = p\.default_category_id/);
    // base-set match OR project-scoped extension set owned by the project
    expect(sql).toMatch(/cat\.category_set_id = p\.category_set_id/);
    expect(sql).toMatch(/cs\.project_id = p\.id/);
  });

  it("teaches api_log_entry to take a category and default to the project's", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS api_log_entry\(/);
    expect(sql).toMatch(/p_category_id UUID DEFAULT NULL/);
    expect(sql).toMatch(/resolved_category := COALESCE\(\s*\n?\s*p_category_id/);
    // explicit invalid → TK400; stale project default → dropped to NULL
    expect(sql).toMatch(
      /category does not belong to the project' USING ERRCODE = 'TK400'/,
    );
    expect(sql).toMatch(/resolved_category := NULL/);
    // and the resolved category is actually inserted
    expect(sql).toMatch(/category_id,\s*\n\s*started_by_kind/);
  });

  it("keeps api_log_entry anon-only (SAL-054: PUBLIC + authenticated revoked)", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION api_log_entry\([\s\S]*?FROM PUBLIC, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION api_log_entry\([\s\S]*?TO anon/);
  });

  it("re-projects default_category_id on projects_v (frozen-column rule)", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.projects_v/);
    expect(sql).toMatch(/p\.default_category_id\s+FROM public\.projects p;/);
  });
});

describe("list_projects is_default boolean coercion (20260721150000)", () => {
  const sql = readMigration("list_projects_is_default_boolean");

  it("coerces is_default to a boolean so it is never null", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION api_list_projects/);
    expect(sql).toMatch(
      /'is_default', COALESCE\(cat\.id = p\.default_category_id, false\)/,
    );
  });
});

describe("agent log — internal projects are non-billable (20260721160000)", () => {
  const sql = readMigration("agent_log_internal_nonbillable");

  it("captures the project's is_internal classification", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION api_log_entry/);
    expect(sql).toMatch(/SELECT p\.is_internal INTO v_is_internal/);
  });

  it("forces billable=false for internal projects, else explicit-or-token-default", () => {
    expect(sql).toMatch(
      /CASE WHEN v_is_internal THEN false\s*\n?\s*ELSE COALESCE\(p_billable, tok\.default_billable\) END/,
    );
  });
});

describe("list_projects exposes github_repo (20260722100000)", () => {
  const sql = readMigration("list_projects_github_repo");

  it("embeds github_repo in each project object", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION api_list_projects/);
    expect(sql).toMatch(/'github_repo', p\.github_repo/);
  });
});

describe("agent log — overlap guard is project-scoped (20260722110000)", () => {
  const sql = readMigration("agent_log_overlap_same_project");

  it("scopes the overlap check to the same project (cross-project parallel work coexists)", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION api_log_entry/);
    expect(sql).toMatch(
      /FROM time_entries te\s*\n\s*WHERE te\.user_id = tok\.user_id\s*\n\s*AND te\.project_id = p_project_id/,
    );
  });
});

describe("project billing mode / fixed-bid (20260722120000)", () => {
  const sql = readMigration("project_billing_mode");

  it("adds billing_mode (default hourly) + fixed_price with CHECKs", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'hourly'/,
    );
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS fixed_price NUMERIC\(10,2\)/);
    expect(sql).toMatch(/CHECK \(billing_mode IN \('hourly', 'fixed_bid'\)\)/);
    // fixed-bid implies a paying customer (never internal)
    expect(sql).toMatch(
      /CHECK \(billing_mode = 'hourly' OR is_internal = false\)/,
    );
  });

  it("re-projects billing_mode + fixed_price on projects_v (frozen-column rule)", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.projects_v/);
    expect(sql).toMatch(/p\.billing_mode,/);
    expect(sql).toMatch(/THEN p\.fixed_price/);
  });
});

describe("agent log — backdating policy (EFFECTIVE api_log_entry definition)", () => {
  // Latest-definition-wins: assert on whatever migration currently owns
  // api_log_entry, so redefinition #6 cannot silently re-add a day cap or
  // re-collapse the refusal messages while these stay green.
  const sql = latestCreateFunction("api_log_entry");

  it("has NO fixed backdating window — only the 1-year wrong-year sanity bound", () => {
    expect(sql).not.toMatch(/interval '7 days'/);
    expect(sql).toMatch(/p_start_time < now\(\) - interval '365 days'/);
  });

  it("refuses entries dated in a locked period as a policy 403, not the trigger's opaque 500", () => {
    expect(sql).toMatch(/team_period_lock_at\(tok\.team_id\)/);
    expect(sql).toMatch(/'reason', 'period_locked'/);
    // Boundary parity with trg_time_entries_period_lock_guard: inclusive <=
    // on the ::date cast. Drifting to < re-opens the opaque-500 window for
    // entries dated exactly on period_end.
    expect(sql).toMatch(/\(p_start_time\)::date <= v_lock_end/);
    expect(sql).toMatch(
      /period locked: the books are closed through %[\s\S]*?USING ERRCODE = 'TK403'/,
    );
  });

  it("names each time-range refusal instead of one collapsed 'invalid time range'", () => {
    expect(sql).toMatch(/'reason', 'end_time_in_future'/);
    expect(sql).toMatch(/'reason', 'entry_exceeds_24h'/);
    expect(sql).toMatch(/'reason', 'start_time_too_old'/);
    expect(sql).toMatch(/end_time must be after start_time/);
  });

  it("keeps the unchanged guards (24h cap, 5-min skew, same-project overlap, internal non-billable)", () => {
    expect(sql).toMatch(/p_end_time - p_start_time > interval '24 hours'/);
    expect(sql).toMatch(/p_end_time > now\(\) \+ interval '5 minutes'/);
    expect(sql).toMatch(/AND te\.project_id = p_project_id/);
    expect(sql).toMatch(/CASE WHEN v_is_internal THEN false/);
  });
});

describe("project setting inheritance (20260723100000, EFFECTIVE definitions)", () => {
  // Latest-definition-wins: nested projects with NULL category columns
  // resolve the parent's vocabulary LIVE (inherit.ts model). These pin
  // the DB half so a future redefinition can't silently drop it.

  it("api_log_entry resolves the category vocabulary via the parent when the child has no base set", () => {
    const sql = latestCreateFunction("api_log_entry");
    expect(sql).toMatch(
      /LEFT JOIN projects par ON par\.id = p\.parent_project_id/,
    );
    expect(sql).toMatch(/COALESCE\(p\.category_set_id, par\.category_set_id\)/);
    // Parent-owned extension sets join the vocabulary ONLY while inheriting.
    expect(sql).toMatch(/v_own_set IS NULL AND cs\.project_id = v_parent_id/);
  });

  it("api_list_projects returns the child's EFFECTIVE categories + default — but NEVER inherits github_repo (repo→project mapping stays unambiguous)", () => {
    const sql = latestCreateFunction("api_list_projects");
    expect(sql).toMatch(
      /COALESCE\(p\.category_set_id, par\.category_set_id\) AS effective_set_id/,
    );
    expect(sql).toMatch(/'default_category_id', eff\.effective_default_id/);
    expect(sql).toMatch(/'github_repo', p\.github_repo/);
  });

  it("validate_time_entry_category accepts the inherited vocabulary on app-side writes", () => {
    const sql = latestCreateFunction("public\\.validate_time_entry_category");
    expect(sql).toMatch(/COALESCE\(p\.category_set_id, par\.category_set_id\)/);
    expect(sql).toMatch(
      /project_set_id IS NULL\s*\n?\s*AND cat_set_project_id = project_parent_id/,
    );
  });
});

describe("project lifetime dollar cap / NTE (20260722140000)", () => {
  const sql = readMigration("project_budget_dollars");

  it("adds budget_dollars with a non-negative CHECK", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS budget_dollars NUMERIC\(12, 2\)/,
    );
    expect(sql).toMatch(/CHECK \(budget_dollars IS NULL OR budget_dollars >= 0\)/);
  });

  it("re-projects a rate-gated budget_dollars on projects_v (frozen-column rule)", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.projects_v/);
    expect(sql).toMatch(/THEN p\.budget_dollars/);
    expect(sql).toMatch(/can_view_project_rate/);
  });
});
