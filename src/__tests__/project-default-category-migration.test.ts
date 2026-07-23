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
    .find((f) => f.includes(substr));
  if (!file) throw new Error(`migration containing "${substr}" not found`);
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
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
