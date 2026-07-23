/**
 * Smoke test on the document sign-off foundation migration
 * (`20260723130000`). No real DB in CI, so this pins the security posture the
 * feature depends on — the same hardened patterns as the proposals sign-off
 * (SAL-036/037/038/042/045/046), re-instantiated for a parallel table set.
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
  if (!file) throw new Error(`migration "_${substr}.sql" not found`);
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

const sql = readMigration("signoff_foundation");

describe("signoff foundation — tables + lifecycle", () => {
  it("creates the five core tables + the history twin", () => {
    for (const t of [
      "signoff_documents",
      "signoff_documents_history",
      "signoff_signers",
      "signoff_tokens",
      "signoff_events",
      "signoff_acceptances",
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`));
    }
  });

  it("stores the document as MARKDOWN, never raw/pandoc HTML (SAL-039)", () => {
    expect(sql).toMatch(/body_markdown\s+TEXT NOT NULL/);
    expect(sql).not.toMatch(/body_html|content_html/);
  });

  it("widens message_outbox.related_kind with signoff + signoff_otp", () => {
    expect(sql).toMatch(/related_kind IN \([^)]*'signoff'[^)]*'signoff_otp'[^)]*\)/s);
  });
});

describe("signoff foundation — security posture (mirrors proposals)", () => {
  it("token stored as a hash, single-use + revocable + OTP + view-session", () => {
    expect(sql).toMatch(/token_hash\s+TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/consumed_at\s+TIMESTAMPTZ/);
    expect(sql).toMatch(/revoked_at\s+TIMESTAMPTZ/);
    expect(sql).toMatch(/otp_code_hash\s+TEXT/);
    expect(sql).toMatch(/view_session_hash\s+TEXT/);
  });

  it("acceptances are immutable: SELECT-only, no client write policies, content-hashed", () => {
    expect(sql).toMatch(/content_snapshot\s+JSONB NOT NULL/);
    expect(sql).toMatch(/content_sha256\s+TEXT NOT NULL/);
    expect(sql).toMatch(/CREATE POLICY "signoff_acc_select"[\s\S]*?FOR SELECT/);
    // No INSERT/UPDATE/DELETE policy on acceptances.
    expect(sql).not.toMatch(/POLICY "signoff_acc_[^"]*"[\s\S]*?FOR (INSERT|UPDATE|DELETE)/);
  });

  it("one acceptance per (document, signer) via the SAL-042 partial indexes", () => {
    expect(sql).toMatch(/uq_signoff_acceptances_single\s*\n?\s*ON public\.signoff_acceptances \(document_id\) WHERE signer_id IS NULL/);
    expect(sql).toMatch(/uq_signoff_acceptances_per_signer\s*\n?\s*ON public\.signoff_acceptances \(document_id, signer_id\) WHERE signer_id IS NOT NULL/);
  });

  it("atomic OTP attempt counter is SECURITY DEFINER + revoked from user roles (SAL-037)", () => {
    expect(sql).toMatch(/FUNCTION public\.signoff_otp_attempt\(p_token_id UUID\)[\s\S]*?SECURITY DEFINER/);
    expect(sql).toMatch(/otp_attempts < 5/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.signoff_otp_attempt\(UUID\) FROM authenticated/);
  });

  it("content is send-locked (default-deny) once past draft, hard-delete blocked", () => {
    expect(sql).toMatch(/tg_signoff_docs_send_lock_guard/);
    expect(sql).toMatch(/\(to_jsonb\(OLD\) - mutable\) = \(to_jsonb\(NEW\) - mutable\)/);
    // The roster is frozen after send too.
    expect(sql).toMatch(/tg_signoff_signers_send_lock_guard/);
  });

  it("SET-NULL FK columns stay strippable through the send-lock (SAL-050): customer/user hard-delete can't trip the freeze", () => {
    const m = sql.match(/mutable CONSTANT text\[\] := ARRAY\[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/'customer_id'/);
    expect(m![1]).toMatch(/'created_by_user_id'/);
  });

  it("customer_id carries the same-team parity check (SAL-033) on insert + update", () => {
    // Both write policies constrain customer_id to the same team.
    const parity = /customer_id IS NULL OR EXISTS \(\s*\n?\s*SELECT 1 FROM public\.customers c WHERE c\.id = customer_id AND c\.team_id = team_id\)/g;
    expect([...sql.matchAll(parity)].length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/"signoff_docs_update"[\s\S]*?WITH CHECK/);
  });

  it("history twin is append-only via a SECURITY DEFINER trigger", () => {
    expect(sql).toMatch(/FUNCTION public\.tg_signoff_docs_log_change[\s\S]*?SECURITY DEFINER/);
    expect(sql).toMatch(/CREATE POLICY "signoff_docs_hist_select"[\s\S]*?FOR SELECT/);
  });
});
