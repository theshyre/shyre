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
  /** PostgREST count for `select(_, { count: 'exact', head: true })` queries. */
  count?: number;
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
  limit: (n: number) => Builder;
  insert: (rows: unknown) => Builder;
  update: (patch: unknown) => Builder;
  single: () => Promise<Result>;
  maybeSingle: () => Promise<Result>;
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
    limit: (...args) => (call.ops.push({ method: "limit", args }), builder),
    insert: (...args) => (call.ops.push({ method: "insert", args }), builder),
    update: (...args) => (call.ops.push({ method: "update", args }), builder),
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
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
  loadSignGate,
  maskEmail,
  issueSignOtp,
  verifySignOtp,
  recordSignDecision,
} from "./sign-service";
import {
  generateSignToken,
  hashOtp,
  sha256Hex,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MINUTES,
} from "./tokens";

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
    queues["proposals"] = [
      { data: proposalRow({ sign_theme: "dark" }), error: null },
    ];
    queues["team_settings"] = [{ data: { business_name: "Malcom IO" }, error: null }];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];

    const result = await loadSignBundle(rawToken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.signTheme).toBe("dark");
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
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verified).toBe(true);
      // A fresh, high-entropy view-session secret is handed back to set as the
      // browser cookie (SAL-045) — never a constant.
      expect(typeof result.value.viewSession).toBe("string");
      expect(result.value.viewSession.length).toBeGreaterThan(20);
    }
    expect(rpcCalls[0]).toEqual({
      fn: "proposal_otp_attempt",
      args: { p_token_id: "tok-1" },
    });
    // The verify UPDATE must persist the view-session hash + expiry.
    const verifiedUpdate = calls.find(
      (c) =>
        c.table === "proposal_access_tokens" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as Record<string, unknown>).view_session_hash != null,
        ),
    );
    expect(verifiedUpdate).toBeDefined();
  });

  it("fails closed (session_failed) if the view-session persist errors", async () => {
    // e.g. the migration hasn't landed yet in the parallel-deploy window: the
    // UPDATE that stores view_session_hash errors. Must NOT return ok (which
    // would set a cookie with no matching server hash and loop the gate).
    queues["proposal_access_tokens"] = [
      { data: tokenWithOtp(), error: null },
      { data: null, error: { message: "column view_session_hash does not exist" } },
    ];
    rpcQueue = [{ data: 1, error: null }];
    const result = await verifySignOtp(rawToken, CODE);
    expect(result).toEqual({ ok: false, reason: "session_failed" });
    expect(logErrorMock).toHaveBeenCalled();
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
  const VIEW_SECRET = "browser-view-secret";
  const verifiedToken = (): Record<string, unknown> =>
    tokenRow({
      otp_verified_at: new Date(NOW - 1000).toISOString(),
      view_session_hash: sha256Hex(VIEW_SECRET),
      view_session_expires_at: new Date(NOW + 3_600_000).toISOString(),
    });

  const decisionInput = {
    decision: "accepted" as const,
    signerName: "Jordan Chen",
    signerTitle: "CTO",
    signatureTyped: "Jordan Chen",
    selectedLineItemIds: ["li-1", "li-2"],
    ipAddress: "203.0.113.5",
    userAgent: "vitest",
    viewSession: VIEW_SECRET,
  };

  it("refuses without a verified OTP", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    const result = await recordSignDecision(rawToken, decisionInput);
    expect(result).toEqual({ ok: false, reason: "otp_required" });
  });

  it("refuses signing without THIS browser's view session, even if OTP is verified (SAL-046)", async () => {
    // A forwarded-link holder: the shared otp_verified_at flag is set (the real
    // signer verified), but they present no / a forged view-session cookie.
    queues["proposal_access_tokens"] = [
      {
        data: tokenRow({
          otp_verified_at: new Date(NOW - 1000).toISOString(),
          view_session_hash: sha256Hex("the-real-secret"),
          view_session_expires_at: new Date(NOW + 3_600_000).toISOString(),
        }),
        error: null,
      },
    ];
    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      viewSession: "forged-or-absent",
    });
    expect(result).toEqual({ ok: false, reason: "otp_required" });
    // Nothing was consumed or written — the attacker's POST is a clean refusal.
    expect(
      calls.some(
        (c) =>
          c.table === "proposal_acceptances" &&
          c.ops.some((o) => o.method === "insert"),
      ),
    ).toBe(false);
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
    // Team default is 8.5% at signing — the acceptance must freeze it.
    queues["team_settings"] = [{ data: { tax_rate: 8.5 }, error: null }];
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
      tax_rate: number | null;
    };
    expect(acceptance.accepted_total).toBe(4950); // computed server-side
    expect(acceptance.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(acceptance.selected_line_item_ids).toEqual(["li-1", "li-2"]);
    expect(acceptance.signer_name).toBe("Jordan Chen");
    expect(acceptance.tax_rate).toBe(8.5); // rate frozen at signing

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

  const verifiedSigner = (signerId: string): Record<string, unknown> =>
    tokenRow({
      otp_verified_at: new Date(NOW - 1000).toISOString(),
      signer_id: signerId,
      view_session_hash: sha256Hex(VIEW_SECRET),
      view_session_expires_at: new Date(NOW + 3_600_000).toISOString(),
    });

  it("'all' mode: the primary's accept records but does NOT complete until every signer has signed", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedSigner("sgnr-1"), error: null },
      { data: [{ id: "tok-1" }], error: null }, // consume wins
    ];
    queues["proposals"] = [{ data: proposalRow({ signing_mode: "all" }), error: null }];
    queues["proposal_signers"] = [
      { data: [{ id: "sgnr-1" }], error: null }, // primary lookup
      { data: null, count: 2, error: null }, // signer count
    ];
    queues["proposal_acceptances"] = [
      { data: [], error: null }, // no prior binding
      { data: null, error: null }, // acceptance insert
      { data: null, count: 1, error: null }, // accepted count (1 of 2)
    ];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    queues["team_settings"] = [{ data: { tax_rate: 0 }, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      selectedLineItemIds: ["li-1", "li-2"],
    });
    expect(result).toEqual({ ok: true, value: { decision: "accepted" } });
    // Acceptance carries the signer_id...
    const acc = calls
      .filter((c) => c.table === "proposal_acceptances")
      .flatMap((c) => c.ops)
      .find((o) => o.method === "insert")!.args[0] as { signer_id?: string };
    expect(acc.signer_id).toBe("sgnr-1");
    // ...but the proposal is NOT yet accepted (1 of 2 signed).
    const flipped = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "accepted",
        ),
    );
    expect(flipped).toBeUndefined();
  });

  it("'all' mode: a co-signer can't sign before the primary — awaiting_primary, no acceptance", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedSigner("sgnr-2"), error: null },
    ];
    queues["proposals"] = [{ data: proposalRow({ signing_mode: "all" }), error: null }];
    queues["proposal_signers"] = [{ data: [{ id: "sgnr-1" }], error: null }]; // primary = sgnr-1
    queues["proposal_acceptances"] = [{ data: [], error: null }]; // no binding yet

    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      selectedLineItemIds: ["li-1"],
    });
    expect(result).toEqual({ ok: false, reason: "awaiting_primary" });
    expect(
      calls.find(
        (c) =>
          c.table === "proposal_acceptances" &&
          c.ops.some((o) => o.method === "insert"),
      ),
    ).toBeUndefined();
  });

  it("'all' mode: the final signer completes it — status accepted, BOUND to the primary's subset", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedSigner("sgnr-2"), error: null },
      { data: [{ id: "tok-1" }], error: null },
    ];
    queues["proposals"] = [
      { data: proposalRow({ signing_mode: "all" }), error: null },
      { data: null, error: null }, // status update
    ];
    queues["proposal_signers"] = [
      { data: [{ id: "sgnr-1" }], error: null },
      { data: null, count: 2, error: null },
    ];
    queues["proposal_acceptances"] = [
      { data: [{ selected_line_item_ids: ["li-1"] }], error: null }, // primary bound li-1 only
      { data: null, error: null },
      { data: null, count: 2, error: null }, // now all 2 accepted
    ];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    queues["team_settings"] = [{ data: { tax_rate: 0 }, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    // Co-signer TRIES to select both — but is bound to the primary's [li-1].
    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      selectedLineItemIds: ["li-1", "li-2"],
    });
    expect(result).toEqual({ ok: true, value: { decision: "accepted" } });
    const acc = calls
      .filter((c) => c.table === "proposal_acceptances")
      .flatMap((c) => c.ops)
      .find((o) => o.method === "insert")!.args[0] as {
      selected_line_item_ids: string[];
      accepted_total: number;
    };
    expect(acc.selected_line_item_ids).toEqual(["li-1"]); // bound, not their pick
    expect(acc.accepted_total).toBe(950);
    const flipped = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "accepted",
        ),
    );
    expect(flipped).toBeDefined();
  });

  it("'all' mode: any decline kills the deal — status declined", async () => {
    queues["proposal_access_tokens"] = [
      { data: verifiedSigner("sgnr-1"), error: null },
      { data: [{ id: "tok-1" }], error: null },
    ];
    queues["proposals"] = [
      { data: proposalRow({ signing_mode: "all" }), error: null },
      { data: null, error: null },
    ];
    queues["proposal_signers"] = [{ data: [{ id: "sgnr-1" }], error: null }];
    queues["proposal_acceptances"] = [
      { data: [], error: null },
      { data: null, error: null },
    ];
    queues["proposal_line_items"] = [{ data: ITEM_ROWS, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    const result = await recordSignDecision(rawToken, {
      ...decisionInput,
      decision: "declined",
      selectedLineItemIds: [],
    });
    expect(result).toEqual({ ok: true, value: { decision: "declined" } });
    const declined = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "declined",
        ),
    );
    expect(declined).toBeDefined();
  });

  it("refuses when the proposal is in a non-signable state", async () => {
    queues["proposal_access_tokens"] = [{ data: verifiedToken(), error: null }];
    queues["proposals"] = [{ data: proposalRow({ status: "declined" }), error: null }];
    const result = await recordSignDecision(rawToken, decisionInput);
    expect(result).toEqual({ ok: false, reason: "invalid_state" });
  });
});

describe("maskEmail", () => {
  it("keeps the domain + first two chars, masks the rest", () => {
    expect(maskEmail("jordan@eyereg.example")).toBe("jo•••@eyereg.example");
  });
  it("degrades safely on a 1-char local part and on non-emails", () => {
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
    expect(maskEmail("notanemail")).toBe("•••");
  });
});

describe("loadSignGate (SAL-045 identity gate)", () => {
  const brandRow = {
    data: {
      business_name: "Malcom IO",
      logo_url: "https://cdn.example/logo.png",
      brand_color: "#0a0",
      wordmark_primary: "malcom",
      wordmark_secondary: ".io",
    },
    error: null,
  };

  it("rejects an unknown token without exposing anything", async () => {
    queues["proposal_access_tokens"] = [{ data: null, error: null }];
    expect(await loadSignGate(rawToken, null)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("is unverified with a masked recipient when there is no cookie", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    queues["team_settings"] = [brandRow];
    const result = await loadSignGate(rawToken, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verified).toBe(false);
      expect(result.value.maskedEmail).toBe("jo•••@eyereg.example");
      expect(result.value.businessName).toBe("Malcom IO");
      expect(result.value.decided).toBe(false);
    }
  });

  it("verifies when the cookie matches the stored view-session hash", async () => {
    const secret = "browser-session-secret";
    queues["proposal_access_tokens"] = [
      {
        data: tokenRow({
          view_session_hash: sha256Hex(secret),
          view_session_expires_at: new Date(NOW + 3_600_000).toISOString(),
        }),
        error: null,
      },
    ];
    queues["team_settings"] = [brandRow];
    const result = await loadSignGate(rawToken, secret);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verified).toBe(true);
  });

  it("stays unverified when the view session has expired", async () => {
    const secret = "browser-session-secret";
    queues["proposal_access_tokens"] = [
      {
        data: tokenRow({
          view_session_hash: sha256Hex(secret),
          view_session_expires_at: new Date(NOW - 1000).toISOString(),
        }),
        error: null,
      },
    ];
    queues["team_settings"] = [brandRow];
    const result = await loadSignGate(rawToken, secret);
    if (result.ok) expect(result.value.verified).toBe(false);
  });

  it("stays unverified when a forged cookie doesn't match the hash", async () => {
    queues["proposal_access_tokens"] = [
      {
        data: tokenRow({
          view_session_hash: sha256Hex("the-real-secret"),
          view_session_expires_at: new Date(NOW + 3_600_000).toISOString(),
        }),
        error: null,
      },
    ];
    queues["team_settings"] = [brandRow];
    const result = await loadSignGate(rawToken, "a-forged-value");
    if (result.ok) expect(result.value.verified).toBe(false);
  });

  it("marks a consumed link as decided (terminal gate, no OTP form)", async () => {
    queues["proposal_access_tokens"] = [
      { data: tokenRow({ consumed_at: new Date(NOW - 1000).toISOString() }), error: null },
    ];
    queues["team_settings"] = [brandRow];
    const result = await loadSignGate(rawToken, null);
    if (result.ok) expect(result.value.decided).toBe(true);
  });

  it("reads no proposal CONTENT at the gate — only the pinned theme colour", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    queues["team_settings"] = [brandRow];
    queues["proposals"] = [{ data: { sign_theme: "light" }, error: null }];
    await loadSignGate(rawToken, null);
    // The pricing/scope (line items) never loads at the gate.
    expect(calls.some((c) => c.table === "proposal_line_items")).toBe(false);
    // The only column read from `proposals` is the theme — never content.
    const proposalSelects = calls
      .filter((c) => c.table === "proposals")
      .flatMap((c) => c.ops)
      .filter((o) => o.method === "select")
      .map((o) => o.args[0]);
    for (const cols of proposalSelects) {
      expect(cols).toBe("sign_theme");
    }
  });

  it("returns the author-pinned theme, defaulting a bad value to light", async () => {
    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    queues["team_settings"] = [brandRow];
    queues["proposals"] = [{ data: { sign_theme: "warm" }, error: null }];
    const warm = await loadSignGate(rawToken, null);
    if (warm.ok) expect(warm.value.signTheme).toBe("warm");

    queues["proposal_access_tokens"] = [{ data: tokenRow(), error: null }];
    queues["team_settings"] = [brandRow];
    queues["proposals"] = [{ data: { sign_theme: "neon" }, error: null }];
    const bad = await loadSignGate(rawToken, null);
    if (bad.ok) expect(bad.value.signTheme).toBe("light");
  });
});
