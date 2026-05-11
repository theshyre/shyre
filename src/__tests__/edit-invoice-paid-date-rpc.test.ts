/**
 * Smoke test on the `edit_invoice_paid_date` RPC migration.
 *
 * We can't run a real DB in CI here (per testing-roadmap), but we
 * CAN regression-guard the invariant the bookkeeper review insisted
 * on: the function must update BOTH `invoices.paid_at` AND the
 * canonical `invoice_payments` row in the same call, or the two
 * tables silently drift. This test reads the migration SQL and
 * asserts both UPDATEs (plus the 0-payment INSERT branch) are
 * present in the function body.
 *
 * If you re-shape the RPC, update the assertions — but pay attention
 * to *why* they fail before relaxing them. Silent paid_at vs.
 * paid_on drift is the bug class this test exists to catch.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigrationFile(predicate: (name: string) => boolean): string {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .find(predicate);
  if (!file) throw new Error("Migration file not found");
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

describe("edit_invoice_paid_date RPC migration", () => {
  const sql = readMigrationFile((f) =>
    f.includes("edit_invoice_paid_date"),
  );

  it("defines the function as SECURITY DEFINER (so RLS doesn't block the cross-table writes)", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.edit_invoice_paid_date/);
    expect(sql).toMatch(/SECURITY DEFINER/);
  });

  it("enforces the >=10-char reason rule inside the function", () => {
    expect(sql).toMatch(/length\(trim\(p_reason\)\)\s*<\s*10/);
  });

  it("enforces the owner|admin role check via user_team_role", () => {
    expect(sql).toMatch(/user_team_role\(v_invoice\.team_id\)/);
    expect(sql).toMatch(/IN\s*\(\s*'owner',\s*'admin'\s*\)/);
  });

  it("enforces paid_on >= issued_date (cash basis)", () => {
    expect(sql).toMatch(/p_new_paid_on\s*<\s*v_invoice\.issued_date/);
  });

  it("rejects future-dated paid_on", () => {
    expect(sql).toMatch(/p_new_paid_on\s*>\s*CURRENT_DATE/);
  });

  it("checks period locks on BOTH the new date and the old date", () => {
    // Both branches must be present — the existing
    // tg_invoices_period_lock_guard does not catch status-only
    // updates, so this RPC has to enforce both directions.
    expect(sql).toMatch(/p_new_paid_on\s*<=\s*v_lock_end/);
    expect(sql).toMatch(/v_old_paid\s*IS NOT NULL AND v_old_paid\s*<=\s*v_lock_end/);
  });

  it("writes the correction reason into the history GUC for the trigger to pick up", () => {
    expect(sql).toMatch(/set_config\('shyre\.correction_reason'/);
  });

  it("updates invoices.paid_at AND writes the invoice_payments row in the same function", () => {
    // The bookkeeper-flagged invariant: every code path must touch
    // BOTH tables. 0-payment branch INSERTs the synthetic payment;
    // 1-payment branch UPDATEs the existing payment's paid_on; the
    // final UPDATE mirrors onto invoices.paid_at unconditionally.
    expect(sql).toMatch(
      /INSERT INTO public\.invoice_payments[\s\S]*?VALUES\s*\(/,
    );
    expect(sql).toMatch(
      /UPDATE public\.invoice_payments[\s\S]*?SET paid_on = p_new_paid_on/,
    );
    expect(sql).toMatch(
      /UPDATE public\.invoices[\s\S]*?SET paid_at = p_new_paid_on::TIMESTAMPTZ/,
    );
  });

  it("rejects 2+ payment invoices with a message that names the dates", () => {
    // Pointer to where users go (or what they say to support) when
    // the per-payment edit UI doesn't exist yet.
    expect(sql).toMatch(/% payments dated %/);
  });

  it("history trigger reads shyre.correction_reason from a session-local GUC", () => {
    // The other half of the contract: the trigger has to be willing
    // to *write* the reason that the RPC sets. Without this,
    // correction reasons land nowhere.
    expect(sql).toMatch(
      /current_setting\('shyre\.correction_reason',\s*true\)/,
    );
  });

  it("grants EXECUTE to authenticated only (never anon)", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.edit_invoice_paid_date\(UUID, DATE, TEXT\)[\s\S]*?TO authenticated/,
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.edit_invoice_paid_date\(UUID, DATE, TEXT\)[\s\S]*?TO anon/,
    );
  });
});
