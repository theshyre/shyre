import { describe, it, expect, vi, beforeEach } from "vitest";

// server-only guard is stubbed globally in src/test/setup.ts.

const sendEmailMock = vi.fn().mockResolvedValue({ outboxId: "ob-1", providerMessageId: "pm-1" });
vi.mock("@/lib/messaging/send-proposal", () => ({
  sendProposalEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

// --- Chainable admin-client stub (queue-per-table, thenable builder).
interface Result {
  data: unknown;
  error: unknown;
}
interface Call {
  table: string;
  ops: Array<{ method: string; args: unknown[] }>;
}
let queues: Record<string, Result[]> = {};
let calls: Call[] = [];

interface Builder extends PromiseLike<Result> {
  select: (cols?: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  is: (col: string, val: unknown) => Builder;
  order: (col: string) => Builder;
  insert: (rows: unknown) => Builder;
  update: (patch: unknown) => Builder;
  single: () => Promise<Result>;
}

function makeBuilder(table: string): Builder {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const resolve = (): Result => queues[table]?.shift() ?? { data: null, error: null };
  const builder: Builder = {
    select: (...args) => (call.ops.push({ method: "select", args }), builder),
    eq: (...args) => (call.ops.push({ method: "eq", args }), builder),
    is: (...args) => (call.ops.push({ method: "is", args }), builder),
    order: (...args) => (call.ops.push({ method: "order", args }), builder),
    insert: (...args) => (call.ops.push({ method: "insert", args }), builder),
    update: (...args) => (call.ops.push({ method: "update", args }), builder),
    single: () => Promise.resolve(resolve()),
    then: (onF, onR) => Promise.resolve(resolve()).then(onF, onR),
  };
  return builder;
}

/** Queue of results for admin.rpc calls (the atomic OTP increment). */
let rpcQueue: Result[] = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder(table),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcQueue.shift() ?? { data: null, error: null });
    },
  }),
}));

import {
  loadSignBundle,
  issueSignOtp,
  verifySignOtp,
  recordSignDecision,
} from "./sign-service";
import { generateSignToken, hashOtp, MAX_OTP_ATTEMPTS, OTP_TTL_MINUTES } from "./tokens";

const NOW = Date.now();

function tokenRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "tok-1",
    proposal_id: "prop-1",
    team_id: "team-1",
    signer_email: "jordan@eyereg.example",
    signer_name: "Jordan Chen",
    expires_at: new Date(NOW + 86_400_000).toISOString(),
    revoked_at: null,
    consumed_at: null,
    first_viewed_at: new Date(NOW - 1000).toISOString(), // already viewed
    otp_code_hash: null,
    otp_expires_at: null,
    otp_attempts: 0,
    otp_verified_at: null,
    ...overrides,
  };
}

function proposalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prop-1",
    team_id: "team-1",
    proposal_number: "PROP-2026-001",
    title: "Modernization",
    status: "viewed",
    issued_date: "2026-07-16",
    valid_until: null,
    payment_terms_label: "Net 30",
    deposit_type: "none",
    deposit_value: null,
    warranty_days: null,
    terms_notes: null,
    currency: "USD",
    customers: { name: "EyeReg" },
    ...overrides,
  };
}

const ITEM_ROWS = [
  { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Upgrades", description: null, why_it_matters: null, out_of_scope: null, definition_of_done: null, fixed_price: 950, is_capped: false },
  { id: "li-2", parent_line_item_id: null, sort_order: 1, title: "Modernize", description: null, why_it_matters: null, out_of_scope: null, definition_of_done: null, fixed_price: 4000, is_capped: true },
  { id: "li-3", parent_line_item_id: "li-2", sort_order: 0, title: "Phase A", description: null, why_it_matters: null, out_of_scope: null, definition_of_done: null, fixed_price: 4000, is_capped: false },
];

const rawToken = generateSignToken().raw;

beforeEach(() => {
  queues = {};
  calls = [];
  rpcQueue = [];
  rpcCalls.length = 0;
  sendEmailMock.mockClear();
  logErrorMock.mockClear();
});

describe("loadSignBundle", () => {
  it("returns not_found for an unknown token", async () => {
    queues["proposal_access_tokens"] = [{ data: null, error: null }];
    const result = await loadSignBundle(rawToken);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns expired / revoked for dead tokens", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenRow({ expires_at: new Date(NOW - 1000).toISOString() }), error: null },
    ];
    expect(await loadSignBundle(rawToken)).toEqual({ ok: false, reason: "expired" });

    queues["proposal_access_tokens"] = [
      { data: tokenRow({ revoked_at: new Date(NOW).toISOString() }), error: null },
    ];
    expect(await loadSignBundle(rawToken)).toEqual({ ok: false, reason: "revoked" });
  });

  it("builds the bundle with the top-level item tree", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    queues["proposals"] = [{ data: proposalRow(), error: null }];
    queues["team_settings"] = [{ data: { business_name: "Malcom IO" }, error: null }];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];

    const result = await loadSignBundle(rawToken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items[1]).toMatchObject({
      id: "li-2",
      fixedPrice: 4000,
      phases: [{ title: "Phase A", fixedPrice: 4000 }],
    });
    expect(result.value.businessName).toBe("Malcom IO");
    expect(result.value.otpVerified).toBe(false);
    expect(result.value.decided).toBe(false);
  });

  it("records the first view: token stamp + event + sent→viewed flip", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenRow({ first_viewed_at: null }), error: null },
      { data: null, error: null }, // first_viewed_at update
    ];
    queues["proposals"] = [
      { data: proposalRow({ status: "sent" }), error: null },
      { data: null, error: null }, // status update
    ];
    queues["team_settings"] = [{ data: { business_name: null }, error: null }];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    const result = await loadSignBundle(rawToken);
    expect(result.ok).toBe(true);

    const eventInsert = calls.find(
      (c) => c.table === "proposal_events" && c.ops.some((o) => o.method === "insert"),
    );
    expect(eventInsert).toBeDefined();
    const row = eventInsert!.ops.find((o) => o.method === "insert")!.args[0] as {
      event_type: string;
      actor_user_id: null;
    };
    expect(row.event_type).toBe("viewed");
    expect(row.actor_user_id).toBeNull();

    const statusUpdate = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some((o) => o.method === "update" && (o.args[0] as { status?: string }).status === "viewed"),
    );
    expect(statusUpdate).toBeDefined();
  });
});

describe("issueSignOtp", () => {
  it("stores a bound hash, emails the code, and logs otp_sent", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenRow(), error: null },
      { data: null, error: null }, // otp update
    ];
    queues["proposal_events"] = [{ data: null, error: null }];

    const result = await issueSignOtp(rawToken);
    expect(result).toEqual({ ok: true, value: { sentTo: "jordan@eyereg.example" } });

    // The stored hash is bound to the token id and matches the emailed code.
    const otpUpdate = calls
      .filter((c) => c.table === "proposal_access_tokens")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"))
      .map((o) => o.args[0] as { otp_code_hash?: string; otp_attempts?: number })
      .find((p) => p.otp_code_hash);
    expect(otpUpdate?.otp_attempts).toBe(0);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailInput = sendEmailMock.mock.calls[0]![1] as {
      kind: string;
      toEmail: string;
      subject: string;
      bodyText: string;
    };
    expect(emailInput.kind).toBe("proposal_otp");
    expect(emailInput.toEmail).toBe("jordan@eyereg.example");
    // The code lives in the BODY only — subjects leak via lock-screen
    // previews and mail logs.
    expect(emailInput.subject).not.toMatch(/\d{6}/);
    const code = /(\d{6})/.exec(emailInput.bodyText)?.[1];
    expect(code).toBeDefined();
    expect(otpUpdate?.otp_code_hash).toBe(hashOtp("tok-1", code!));
  });

  it("refuses re-issue during the 60s cooldown", async () => {
    const freshExpiry = new Date(NOW + OTP_TTL_MINUTES * 60_000 - 5_000);
    queues["proposal_access_tokens"] = [
      { data: tokenRow({ otp_expires_at: freshExpiry.toISOString() }), error: null },
    ];
    const result = await issueSignOtp(rawToken);
    expect(result).toEqual({ ok: false, reason: "otp_cooldown" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("surfaces email failure without crashing", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("resend down"));
    queues["proposal_access_tokens"] = [
      { data: tokenRow(), error: null },
      { data: null, error: null },
    ];
    const result = await issueSignOtp(rawToken);
    expect(result).toEqual({ ok: false, reason: "email_failed" });
    expect(logErrorMock).toHaveBeenCalled();
  });
});

describe("verifySignOtp", () => {
  const CODE = "123456";
  function tokenWithOtp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return tokenRow({
      otp_code_hash: hashOtp("tok-1", CODE),
      otp_expires_at: new Date(NOW + 5 * 60_000).toISOString(),
      ...overrides,
    });
  }

  it("verifies the right code through the ATOMIC attempt increment", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenWithOtp(), error: null },
      { data: null, error: null }, // verified update
    ];
    rpcQueue = [{ data: 1, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];
    const result = await verifySignOtp(rawToken, CODE);
    expect(result).toEqual({ ok: true, value: { verified: true } });
    expect(rpcCalls[0]).toEqual({
      fn: "proposal_otp_attempt",
      args: { p_token_id: "tok-1" },
    });
  });

  it("rejects a wrong code, burns an attempt, and logs otp_failed evidence", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenWithOtp(), error: null }];
    rpcQueue = [{ data: 1, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];
    const result = await verifySignOtp(rawToken, "000000");
    expect(result).toEqual({ ok: false, reason: "otp_invalid" });
    const failEvent = calls.find(
      (c) => c.table === "proposal_events" && c.ops.some((o) => o.method === "insert"),
    );
    expect(failEvent).toBeDefined();
  });

  it("reports locked when the wrong guess consumed the final attempt", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenWithOtp(), error: null }];
    rpcQueue = [{ data: MAX_OTP_ATTEMPTS, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];
    const result = await verifySignOtp(rawToken, "000000");
    expect(result).toEqual({ ok: false, reason: "otp_locked" });
  });

  it("locks when the atomic increment returns NULL (budget exhausted — race-proof)", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenWithOtp({ otp_attempts: MAX_OTP_ATTEMPTS }), error: null },
    ];
    rpcQueue = [{ data: null, error: null }]; // conditional UPDATE matched no row
    expect(await verifySignOtp(rawToken, CODE)).toEqual({ ok: false, reason: "otp_locked" });
  });

  it("refuses expired or never-issued codes before burning any attempt", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenWithOtp({ otp_expires_at: new Date(NOW - 1000).toISOString() }), error: null },
    ];
    expect(await verifySignOtp(rawToken, CODE)).toEqual({ ok: false, reason: "otp_expired" });

    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    expect(await verifySignOtp(rawToken, CODE)).toEqual({ ok: false, reason: "otp_required" });
    expect(rpcCalls).toHaveLength(0); // pre-checks never touch the budget
  });
});

describe("recordSignDecision", () => {
  const verifiedToken = (): Record<string, unknown> =>
    tokenRow({ otp_verified_at: new Date(NOW - 1000).toISOString() });

  const decisionInput = {
    decision: "accepted" as const,
    signerName: "Jordan Chen",
    signerTitle: "CTO",
    signatureTyped: "Jordan Chen",
    selectedLineItemIds: ["li-1", "li-2"],
    ipAddress: "203.0.113.5",
    userAgent: "vitest",
  };

  it("refuses without a verified OTP", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    const result = await recordSignDecision(rawToken, decisionInput);
    expect(result).toEqual({ ok: false, reason: "otp_required" });
  });

  it("refuses a consumed token (no double-accept)", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenRow({ consumed_at: new Date(NOW).toISOString(), otp_verified_at: new Date(NOW).toISOString() }), error: null },
    ];
    const result = await recordSignDecision(rawToken, decisionInput);
    expect(result).toEqual({ ok: false, reason: "consumed" });
  });

  it("refuses selections containing unknown or phase item ids", async () => {
    queues["proposal_access_tokens"] = [{ data: verifiedToken(), error: null }];
    queues["proposals"] = [{ data: proposalRow(), error: null }];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      selectedLineItemIds: ["li-1", "li-3"], // li-3 is a phase, not selectable
    });
    expect(result).toEqual({ ok: false, reason: "invalid_selection" });
  });

  it("refuses when a concurrent submit already consumed the token (SAL-038)", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedToken(), error: null },
      { data: [], error: null }, // conditional consume matched no row
    ];
    queues["proposals"] = [{ data: proposalRow(), error: null }];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    const result = await recordSignDecision(rawToken, decisionInput);
    expect(result).toEqual({ ok: false, reason: "consumed" });
    // The race loser must NOT write a second acceptance record.
    const acceptInsert = calls.find(
      (c) =>
        c.table === "proposal_acceptances" &&
        c.ops.some((o) => o.method === "insert"),
    );
    expect(acceptInsert).toBeUndefined();
  });

  it("accepts a subset: server-computed total, snapshot hash, status flip, token consumed", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedToken(), error: null },
      { data: [{ id: "tok-1" }], error: null }, // conditional consume wins
    ];
    queues["proposals"] = [
      { data: proposalRow(), error: null },
      { data: null, error: null }, // status update
    ];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    queues["proposal_acceptances"] = [{ data: null, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      selectedLineItemIds: ["li-1", "li-2"],
    });
    expect(result).toEqual({ ok: true, value: { decision: "accepted" } });

    const acceptance = calls
      .find((c) => c.table === "proposal_acceptances")!
      .ops.find((o) => o.method === "insert")!.args[0] as {
      accepted_total: number;
      content_sha256: string;
      selected_line_item_ids: string[];
      signer_name: string;
    };
    expect(acceptance.accepted_total).toBe(4950); // computed server-side
    expect(acceptance.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(acceptance.selected_line_item_ids).toEqual(["li-1", "li-2"]);
    expect(acceptance.signer_name).toBe("Jordan Chen");

    const statusUpdate = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some((o) => o.method === "update" && (o.args[0] as { status?: string }).status === "accepted"),
    );
    expect(statusUpdate).toBeDefined();

    const consume = calls.find(
      (c) =>
        c.table === "proposal_access_tokens" &&
        c.ops.some((o) => o.method === "update" && (o.args[0] as { consumed_at?: string }).consumed_at),
    );
    expect(consume).toBeDefined();
  });

  it("records a decline with no selection and null total", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedToken(), error: null },
      { data: [{ id: "tok-1" }], error: null }, // conditional consume wins
    ];
    queues["proposals"] = [
      { data: proposalRow(), error: null },
      { data: null, error: null },
    ];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    queues["proposal_acceptances"] = [{ data: null, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      decision: "declined",
      selectedLineItemIds: [],
    });
    expect(result).toEqual({ ok: true, value: { decision: "declined" } });
    const acceptance = calls
      .find((c) => c.table === "proposal_acceptances")!
      .ops.find((o) => o.method === "insert")!.args[0] as {
      accepted_total: null;
      decision: string;
      selected_line_item_ids: string[];
    };
    expect(acceptance.decision).toBe("declined");
    expect(acceptance.accepted_total).toBeNull();
    expect(acceptance.selected_line_item_ids).toEqual([]);
  });

  it("refuses when the proposal is in a non-signable state", async () => {
    queues["proposal_access_tokens"] = [{ data: verifiedToken(), error: null }];
    queues["proposals"] = [{ data: proposalRow({ status: "declined" }), error: null }];
    const result = await recordSignDecision(rawToken, decisionInput);
    expect(result).toEqual({ ok: false, reason: "invalid_state" });
  });
});
