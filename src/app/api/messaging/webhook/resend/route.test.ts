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
function buildAdmin(rowToReturn: unknown = null) {
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
let adminClient: ReturnType<typeof buildAdmin>;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient,
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { POST } from "./route";

const SECRET = "whsec_dGhpcy1pcy1hLWRldi1zZWNyZXQtZm9yLXdlYmhvb2tzLW9ubHk=";

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  recordEventMock.mockReset();
  adminUpdateMock.mockReset();
  adminSelectMock.mockReset();
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
    recordEventMock.mockResolvedValue(undefined);
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
    recordEventMock.mockResolvedValue(undefined);
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
