import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

// The webhook handler uses `recordEvent` (outbox) + `createAdminClient`
// (Supabase admin) — both have to be stubbed before the route is
// imported. Default stubs return "no row found" so signature-checking
// tests don't accidentally exercise side effects.
const recordEventMock = vi.fn();
vi.mock("@/lib/messaging/outbox", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

const adminUpdateMock = vi.fn();
const adminSelectMock = vi.fn();
interface AdminClientStub {
  from: (table: string) => {
    select: () => {
      eq: () => { maybeSingle: () => Promise<{ data: unknown }> };
    };
    update: (patch: unknown) => { eq: () => Promise<unknown> };
  };
}
function buildAdmin(rowToReturn: unknown = null): AdminClientStub {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            adminSelectMock(rowToReturn) ?? { data: rowToReturn },
        }),
      }),
      update: (patch: unknown) => ({
        eq: async () => adminUpdateMock(patch),
      }),
    })),
  };
}
/** Records (table, patch) so side-effect tests can assert WHICH table
 *  an UPDATE landed on, not just that some update happened. */
const tableUpdateMock = vi.fn();
function buildAdminTables(rows: {
  outbox?: unknown;
  invoice?: unknown;
}): AdminClientStub {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === "message_outbox"
                ? (rows.outbox ?? null)
                : table === "invoices"
                  ? (rows.invoice ?? null)
                  : null,
          }),
        }),
      }),
      update: (patch: unknown) => ({
        eq: async () => tableUpdateMock(table, patch),
      }),
    }),
  };
}
let adminClient: AdminClientStub;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient,
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { POST } from "./route";

const SECRET = "whsec_dGhpcy1pcy1hLWRldi1zZWNyZXQtZm9yLXdlYmhvb2tzLW9ubHk=";

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  recordEventMock.mockReset();
  adminUpdateMock.mockReset();
  adminSelectMock.mockReset();
  tableUpdateMock.mockReset();
  logErrorMock.mockReset();
  adminClient = buildAdmin(null);
});

afterEach(() => {
  delete process.env.RESEND_WEBHOOK_SECRET;
});

function signedRequest(
  body: string,
  opts: {
    secret?: string;
    id?: string;
    timestamp?: string | number;
    /** Override just the signature portion of the header. */
    overrideSig?: string;
    /** Compose the header from a list of `v1,<sig>` pairs. */
    headerParts?: string[];
  } = {},
): Request {
  const id = opts.id ?? "msg_test";
  const ts =
    opts.timestamp != null
      ? String(opts.timestamp)
      : String(Math.floor(Date.now() / 1000));
  const secret = opts.secret ?? SECRET;
  const keyBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  const computed = createHmac("sha256", keyBytes)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  const sig = opts.overrideSig ?? computed;
  const header = opts.headerParts
    ? opts.headerParts.join(" ")
    : `v1,${sig}`;
  return new Request("https://shyre.example/api/messaging/webhook/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": header,
    },
    body,
  });
}

describe("Resend webhook — signature verification", () => {
  it("rejects requests with a missing svix-signature header", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = new Request(
      "https://shyre.example/api/messaging/webhook/resend",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": "msg_x",
          "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        body,
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it("rejects requests with a missing svix-id header", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = new Request(
      "https://shyre.example/api/messaging/webhook/resend",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-timestamp": String(Math.floor(Date.now() / 1000)),
          "svix-signature": "v1,deadbeef",
        },
        body,
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with a missing svix-timestamp header", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = new Request(
      "https://shyre.example/api/messaging/webhook/resend",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": "msg_x",
          "svix-signature": "v1,deadbeef",
        },
        body,
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a forged signature (one byte flipped in the body)", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    // Sign one body, swap in a different body — signature won't
    // match because the HMAC includes the body.
    const req = signedRequest(body);
    // Re-construct the request with a tampered body.
    const headers = new Headers(req.headers);
    const tampered = body.replace("delivered", "DELIVERED");
    const forged = new Request(req.url, {
      method: "POST",
      headers,
      body: tampered,
    });
    const res = await POST(forged);
    expect(res.status).toBe(401);
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it("rejects a signature signed with the wrong secret (key rotation drift)", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = signedRequest(body, {
      secret: "whsec_d3Jvbmctc2VjcmV0LXdyb25nLXNlY3JldC13cm9uZy1zZWNyZXQ=",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a timestamp older than 5 minutes (replay-window guard)", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const stale = Math.floor(Date.now() / 1000) - 6 * 60;
    const req = signedRequest(body, { timestamp: stale });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it("rejects a timestamp more than 5 minutes in the future", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const future = Math.floor(Date.now() / 1000) + 6 * 60;
    const req = signedRequest(body, { timestamp: future });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a non-numeric timestamp", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = signedRequest(body, { timestamp: "not-a-number" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts a valid signature and processes the event", async () => {
    adminClient = buildAdmin({
      id: "outbox-1",
      team_id: "team-1",
      related_id: "inv-1",
      related_kind: "invoice",
    });
    // Returning true means "newly recorded" — proceed with side
    // effects (PR2.8 contract).
    recordEventMock.mockResolvedValue(true);
    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-from-resend" },
    });
    const req = signedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(recordEventMock).toHaveBeenCalledWith(
      "outbox-1",
      "email.delivered",
      expect.objectContaining({ type: "email.delivered" }),
      // svix-id passed through for idempotency dedup (PR2.8).
      expect.any(String),
    );
  });

  it("accepts the second signature when the header carries multiple (key rotation)", async () => {
    // Real Resend never sends two — but svix's spec allows it for
    // dual-signing during key rotation. We support it via verifyAny.
    // Compose a header with one bogus + one real signature.
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "msg-from-resend" },
    });
    adminClient = buildAdmin({
      id: "outbox-1",
      team_id: "team-1",
      related_id: "inv-1",
      related_kind: "invoice",
    });
    recordEventMock.mockResolvedValue(true);
    const id = "msg_rotation";
    const ts = String(Math.floor(Date.now() / 1000));
    const realKey = SECRET.startsWith("whsec_")
      ? Buffer.from(SECRET.slice("whsec_".length), "base64")
      : Buffer.from(SECRET, "utf8");
    const realSig = createHmac("sha256", realKey)
      .update(`${id}.${ts}.${body}`)
      .digest("base64");
    const req = new Request(
      "https://shyre.example/api/messaging/webhook/resend",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": id,
          "svix-timestamp": ts,
          "svix-signature": `v1,bogusignaturebogusignaturebogusignature== v1,${realSig}`,
        },
        body,
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(recordEventMock).toHaveBeenCalled();
  });

  it("returns 200 ignored when the same svix-id is replayed (dedup)", async () => {
    // PR2.8: recordEvent returns false to signal "this svix-id
    // was already ingested." The route must short-circuit + skip
    // the customer-flag side effects so a Resend retry doesn't
    // slide the bounced_at timestamp forward.
    adminClient = buildAdmin({
      id: "outbox-1",
      team_id: "team-1",
      related_id: "inv-1",
      related_kind: "invoice",
    });
    recordEventMock.mockResolvedValue(false);
    const body = JSON.stringify({
      type: "email.bounced",
      data: {
        email_id: "msg-from-resend",
        bounce: { message: "Mailbox full" },
      },
    });
    const req = signedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ignored?: string };
    expect(j.ignored).toBe("duplicate svix-id");
    // Side effect (admin update on customers row) should NOT
    // have run — assert no UPDATE was issued after the dedup.
    expect(adminUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 200 ignored when the email_id is missing", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = signedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ignored?: string };
    expect(j.ignored).toBe("no email_id");
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it("returns 200 ignored when the outbox row is unknown", async () => {
    adminClient = buildAdmin(null);
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "msg-never-tracked" },
    });
    const req = signedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ignored?: string };
    expect(j.ignored).toBe("unknown message");
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 when RESEND_WEBHOOK_SECRET is not set", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const req = new Request(
      "https://shyre.example/api/messaging/webhook/resend",
      { method: "POST", body },
    );
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns 400 on malformed JSON body (after signature passes)", async () => {
    // Bypass the signature check by computing it over the raw body.
    const body = "{ this is not valid json";
    const req = signedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("Resend webhook — per-event-type handling", () => {
  const OUTBOX_ROW = {
    id: "outbox-1",
    team_id: "team-1",
    related_id: "inv-1",
    related_kind: "invoice",
  };

  function eventRequest(
    type: string,
    data: Record<string, unknown> = {},
  ): Request {
    return signedRequest(
      JSON.stringify({
        type,
        created_at: new Date().toISOString(),
        data: { email_id: "msg-from-resend", ...data },
      }),
    );
  }

  beforeEach(() => {
    adminClient = buildAdminTables({
      outbox: OUTBOX_ROW,
      invoice: { customer_id: "cust-1" },
    });
    recordEventMock.mockResolvedValue(true);
  });

  it("email.delivered records the event and flags no customer", async () => {
    const res = await POST(eventRequest("email.delivered"));
    expect(res.status).toBe(200);
    expect(recordEventMock).toHaveBeenCalledExactlyOnceWith(
      "outbox-1",
      "email.delivered",
      expect.objectContaining({ type: "email.delivered" }),
      expect.any(String),
    );
    expect(tableUpdateMock).not.toHaveBeenCalled();
  });

  it("email.bounced on an invoice send stamps the customer's bounced_at + bounce reason", async () => {
    const before = Date.now();
    const res = await POST(
      eventRequest("email.bounced", {
        bounce: { message: "Mailbox full", subType: "General" },
      }),
    );
    expect(res.status).toBe(200);
    expect(tableUpdateMock).toHaveBeenCalledTimes(1);
    const [table, patch] = tableUpdateMock.mock.calls[0] as [
      string,
      { bounced_at: string; bounce_reason: string },
    ];
    expect(table).toBe("customers");
    expect(patch.bounce_reason).toBe("Mailbox full");
    // bounced_at is stamped "now", not copied from the payload.
    const stamped = new Date(patch.bounced_at).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it("email.bounced falls back to the bounce subType, then to 'Hard bounce', as the reason", async () => {
    await POST(eventRequest("email.bounced", { bounce: { subType: "Suppressed" } }));
    await POST(eventRequest("email.bounced", {}));
    expect(tableUpdateMock).toHaveBeenCalledTimes(2);
    const patches = tableUpdateMock.mock.calls.map(
      (c) => (c[1] as { bounce_reason: string }).bounce_reason,
    );
    expect(patches).toEqual(["Suppressed", "Hard bounce"]);
  });

  it("email.bounced on a NON-invoice send records the event but never touches customers", async () => {
    adminClient = buildAdminTables({
      outbox: { ...OUTBOX_ROW, related_kind: "proposal" },
      invoice: { customer_id: "cust-1" },
    });
    const res = await POST(
      eventRequest("email.bounced", { bounce: { message: "Mailbox full" } }),
    );
    expect(res.status).toBe(200);
    expect(recordEventMock).toHaveBeenCalledTimes(1);
    expect(tableUpdateMock).not.toHaveBeenCalled();
  });

  it("email.bounced skips the flag quietly when the invoice has no customer", async () => {
    adminClient = buildAdminTables({
      outbox: OUTBOX_ROW,
      invoice: { customer_id: null },
    });
    const res = await POST(
      eventRequest("email.bounced", { bounce: { message: "Mailbox full" } }),
    );
    // Still a 200 — the event itself was recorded; only the optional
    // customer flag is skipped.
    expect(res.status).toBe(200);
    expect(recordEventMock).toHaveBeenCalledTimes(1);
    expect(tableUpdateMock).not.toHaveBeenCalled();
  });

  it("email.complained on an invoice send stamps the customer's complained_at (no bounce fields)", async () => {
    const before = Date.now();
    const res = await POST(eventRequest("email.complained"));
    expect(res.status).toBe(200);
    expect(tableUpdateMock).toHaveBeenCalledTimes(1);
    const [table, patch] = tableUpdateMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe("customers");
    expect(Object.keys(patch)).toEqual(["complained_at"]);
    const stamped = new Date(patch.complained_at as string).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
  });

  it("email.opened is recorded for Phase-2 metrics but triggers no side effects", async () => {
    const res = await POST(eventRequest("email.opened"));
    expect(res.status).toBe(200);
    expect(recordEventMock).toHaveBeenCalledExactlyOnceWith(
      "outbox-1",
      "email.opened",
      expect.objectContaining({ type: "email.opened" }),
      expect.any(String),
    );
    expect(tableUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 500 and logs with team context when event handling throws", async () => {
    recordEventMock.mockRejectedValue(new Error("outbox insert failed"));
    const res = await POST(eventRequest("email.bounced"));
    expect(res.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      expect.objectContaining({
        teamId: "team-1",
        action: "messaging.webhook.resend",
      }),
    );
    // The failed handler must not have half-applied the customer flag.
    expect(tableUpdateMock).not.toHaveBeenCalled();
  });
});
