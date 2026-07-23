import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ outboxId: "ob-1", providerMessageId: "pm-1" });
vi.mock("@/lib/messaging/send-signoff", () => ({
  sendSignoffEmail: (...a: unknown[]) => sendEmailMock(...a),
}));
const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logErrorMock(...a) }));

interface Result { data: unknown; error: unknown; count?: number }
interface Call { table: string; ops: Array<{ method: string; args: unknown[] }> }
let queues: Record<string, Result[]> = {};
let calls: Call[] = [];

function makeBuilder(table: string): Record<string, unknown> {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const resolve = (): Result => queues[table]?.shift() ?? { data: null, error: null };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "insert", "update"]) {
    b[m] = (...args: unknown[]) => {
      call.ops.push({ method: m, args });
      return b;
    };
  }
  b.single = () => Promise.resolve(resolve());
  b.maybeSingle = () => Promise.resolve(resolve());
  b.then = (f: (r: Result) => unknown, r?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(f, r);
  return b;
}
let rpcQueue: Result[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => makeBuilder(t),
    rpc: () => Promise.resolve(rpcQueue.shift() ?? { data: null, error: null }),
  }),
}));

import {
  loadSignGate,
  maskEmail,
  issueSignOtp,
  verifySignOtp,
  recordSignDecision,
} from "./signoff-sign-service";
import { sha256Hex, hashOtp } from "./tokens";

const RAW = "raw-token-abc";
const TOKEN_ID = "tok-1";

function baseToken(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TOKEN_ID,
    document_id: "doc-1",
    team_id: "team-1",
    signer_id: "signer-1",
    signer_email: "bret@fdapproval.com",
    signer_name: "Bret Andre",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
    consumed_at: null,
    first_viewed_at: null,
    otp_code_hash: null,
    otp_expires_at: null,
    otp_attempts: 0,
    otp_verified_at: null,
    view_session_hash: null,
    view_session_expires_at: null,
    ...over,
  };
}

beforeEach(() => {
  queues = {};
  calls = [];
  rpcQueue = [];
  sendEmailMock.mockClear();
  logErrorMock.mockClear();
});

describe("maskEmail", () => {
  it("masks the local part, keeps the domain", () => {
    expect(maskEmail("jordan@acme.com")).toBe("jo•••@acme.com");
    expect(maskEmail("b@x.com")).toBe("b•••@x.com");
    expect(maskEmail("notanemail")).toBe("•••");
  });
});

describe("loadSignGate", () => {
  it("returns not_found for an unknown token", async () => {
    queues["signoff_tokens"] = [{ data: null, error: null }];
    const r = await loadSignGate(RAW, null);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns revoked / expired reasons", async () => {
    queues["signoff_tokens"] = [{ data: baseToken({ revoked_at: new Date().toISOString() }), error: null }];
    expect(await loadSignGate(RAW, null)).toEqual({ ok: false, reason: "revoked" });
    queues["signoff_tokens"] = [{ data: baseToken({ expires_at: new Date(Date.now() - 1000).toISOString() }), error: null }];
    expect(await loadSignGate(RAW, null)).toEqual({ ok: false, reason: "expired" });
  });

  it("masks the email and reports unverified with no cookie", async () => {
    queues["signoff_tokens"] = [{ data: baseToken(), error: null }];
    queues["team_settings"] = [{ data: { business_name: "Malcom IO" }, error: null }];
    queues["signoff_documents"] = [{ data: { sign_theme: "dark" }, error: null }];
    const r = await loadSignGate(RAW, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.verified).toBe(false);
      expect(r.value.maskedEmail).toBe("br•••@fdapproval.com");
      expect(r.value.signTheme).toBe("dark");
      expect(r.value.businessName).toBe("Malcom IO");
    }
  });
});

describe("issueSignOtp", () => {
  it("enforces a 60s cooldown on a still-fresh code", async () => {
    // Issued ~30s ago (otp_expires_at = now + TTL - 30s) → inside the 60s window.
    queues["signoff_tokens"] = [
      { data: baseToken({ otp_expires_at: new Date(Date.now() + 10 * 60_000 - 30_000).toISOString() }), error: null },
    ];
    expect(await issueSignOtp(RAW)).toEqual({ ok: false, reason: "otp_cooldown" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("mints + emails a code and logs otp_sent", async () => {
    queues["signoff_tokens"] = [{ data: baseToken(), error: null }];
    const r = await issueSignOtp(RAW);
    expect(r.ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.table === "signoff_events" && c.ops.some((o) => o.method === "insert"))).toBe(true);
  });
});

describe("verifySignOtp", () => {
  it("locks when the atomic counter returns null", async () => {
    queues["signoff_tokens"] = [
      { data: baseToken({ otp_code_hash: "x", otp_expires_at: new Date(Date.now() + 60_000).toISOString() }), error: null },
    ];
    rpcQueue = [{ data: null, error: null }];
    expect(await verifySignOtp(RAW, "123456")).toEqual({ ok: false, reason: "otp_locked" });
  });

  it("rejects a wrong code and logs the failed attempt", async () => {
    queues["signoff_tokens"] = [
      { data: baseToken({ otp_code_hash: hashOtp(TOKEN_ID, "654321"), otp_expires_at: new Date(Date.now() + 60_000).toISOString() }), error: null },
    ];
    rpcQueue = [{ data: 1, error: null }];
    expect(await verifySignOtp(RAW, "123456")).toEqual({ ok: false, reason: "otp_invalid" });
  });

  it("verifies a correct code and mints a view session", async () => {
    queues["signoff_tokens"] = [
      { data: baseToken({ otp_code_hash: hashOtp(TOKEN_ID, "123456"), otp_expires_at: new Date(Date.now() + 60_000).toISOString() }), error: null },
    ];
    rpcQueue = [{ data: 1, error: null }];
    const r = await verifySignOtp(RAW, "123456");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.viewSession).toBeTruthy();
  });
});

describe("recordSignDecision", () => {
  const secret = "view-secret";
  function verifiedToken(over: Record<string, unknown> = {}): Record<string, unknown> {
    return baseToken({
      otp_verified_at: new Date().toISOString(),
      view_session_hash: sha256Hex(secret),
      view_session_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      ...over,
    });
  }
  const input = {
    decision: "signed" as const,
    signerName: "Bret Andre",
    signerTitle: "Principal Consultant",
    signatureTyped: "Bret Andre",
    signatureMeaning: "approver",
    ipAddress: "1.2.3.4",
    userAgent: "UA",
    viewSession: secret,
  };

  it("refuses a consumed token", async () => {
    queues["signoff_tokens"] = [{ data: verifiedToken({ consumed_at: new Date().toISOString() }), error: null }];
    expect(await recordSignDecision(RAW, input)).toEqual({ ok: false, reason: "consumed" });
  });

  it("refuses without a matching view-session cookie (SAL-046)", async () => {
    queues["signoff_tokens"] = [{ data: verifiedToken(), error: null }];
    expect(await recordSignDecision(RAW, { ...input, viewSession: "wrong" })).toEqual({
      ok: false,
      reason: "otp_required",
    });
  });

  it("records a signature, content-hashes it, and completes an all-mode doc when everyone signed", async () => {
    queues["signoff_tokens"] = [
      { data: verifiedToken(), error: null }, // findValidToken
      { data: { id: TOKEN_ID }, error: null }, // consume-first update .select().maybeSingle()
    ];
    queues["signoff_documents"] = [
      { data: { id: "doc-1", team_id: "team-1", title: "v2.0.2", version_label: "v2.0.2", body_markdown: "# N", status: "viewed", signing_mode: "all" }, error: null },
    ];
    queues["signoff_acceptances"] = [{ data: null, error: null }]; // insert
    queues["signoff_signers"] = [{ data: null, error: null, count: 1 }]; // signer count
    // signed count query also hits signoff_acceptances:
    queues["signoff_acceptances"].push({ data: null, error: null, count: 1 });
    queues["signoff_events"] = [{ data: null, error: null }, { data: null, error: null }];

    const r = await recordSignDecision(RAW, input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.completed).toBe(true);
    // The acceptance insert carries a content hash.
    const accInsert = calls.find((c) => c.table === "signoff_acceptances" && c.ops.some((o) => o.method === "insert"));
    const row = accInsert?.ops.find((o) => o.method === "insert")?.args[0] as Record<string, unknown>;
    expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.signature_meaning).toBe("approver");
  });

  it("marks the doc declined on a decline", async () => {
    queues["signoff_tokens"] = [
      { data: verifiedToken(), error: null },
      { data: { id: TOKEN_ID }, error: null },
    ];
    queues["signoff_documents"] = [
      { data: { id: "doc-1", team_id: "team-1", title: "t", version_label: null, body_markdown: "b", status: "viewed", signing_mode: "all" }, error: null },
    ];
    queues["signoff_acceptances"] = [{ data: null, error: null }];
    const r = await recordSignDecision(RAW, { ...input, decision: "declined", signatureTyped: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.completed).toBe(false);
    const docUpdate = calls.filter((c) => c.table === "signoff_documents" && c.ops.some((o) => o.method === "update"));
    expect(docUpdate.length).toBeGreaterThan(0);
  });
});
