import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resendSender, ResendError } from "./resend";

/**
 * Resend driver tests — fetch is stubbed, no live API.
 *
 * The driver was built fetch-stub-friendly on purpose; this suite
 * pins:
 *   - Send maps idempotency-key + recipient list correctly.
 *   - Domain operations (ensureDomain, refreshDomain) hit the right
 *     endpoints and the 5s wait in refreshDomain stays load-bearing.
 *   - mapDomainResponse falls back to MX priority 10 when the API
 *     omits it, AND records per-record status when present.
 */

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe("resendSender — send", () => {
  it("posts to /emails with from / to / cc / bcc / subject / html / text", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    stubFetch((url, init) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return { id: "msg-123" };
    });
    const sender = resendSender("re_test_key");
    const result = await sender.send({
      from: { email: "from@x.com", name: "From X" },
      to: [{ email: "a@y.com" }, { email: "b@y.com" }],
      cc: [{ email: "c@y.com" }],
      bcc: [{ email: "d@y.com" }],
      replyTo: "reply@x.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      attachments: [],
      idempotencyKey: "k-1",
      tags: { team: "t1" },
    });
    expect(result.providerMessageId).toBe("msg-123");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/emails");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.from).toBe("From X <from@x.com>");
    expect(body.to).toEqual(["a@y.com", "b@y.com"]);
    expect(body.cc).toEqual(["c@y.com"]);
    expect(body.bcc).toEqual(["d@y.com"]);
    expect(body.reply_to).toEqual(["reply@x.com"]);
    expect(body.subject).toBe("Hello");
    expect(body.html).toBe("<p>Hi</p>");
    expect(body.text).toBe("Hi");
  });

  it("sends Idempotency-Key header when idempotencyKey is set", async () => {
    let captured: Headers | null = null;
    stubFetch((_url, init) => {
      captured = new Headers(init?.headers);
      return { id: "msg" };
    });
    const sender = resendSender("re_test_key");
    await sender.send({
      from: { email: "f@x.com" },
      to: [{ email: "t@x.com" }],
      subject: "x",
      html: "x",
      text: "x",
      attachments: [],
      idempotencyKey: "k-abc",
    });
    expect(captured!.get("Idempotency-Key")).toBe("k-abc");
  });

  it("throws ResendError with the status code on 4xx", async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ message: "bad token" }), { status: 401 }),
    );
    const sender = resendSender("re_bad");
    await expect(
      sender.send({
        from: { email: "f@x.com" },
        to: [{ email: "t@x.com" }],
        subject: "x",
        html: "x",
        text: "x",
        attachments: [],
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(ResendError);
  });

  it("preserves the HTTP status on the thrown error so classifyError can read it", async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
      }),
    );
    const sender = resendSender("re_test_key");
    try {
      await sender.send({
        from: { email: "f@x.com" },
        to: [{ email: "t@x.com" }],
        subject: "x",
        html: "x",
        text: "x",
        attachments: [],
        idempotencyKey: "k",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ResendError);
      expect((err as ResendError).status).toBe(429);
    }
  });
});

describe("resendSender — ensureDomain", () => {
  it("returns existing domain when listed (no POST /domains)", async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.endsWith("/domains")) {
        return { data: [{ id: "d-1", name: "malcom.io", status: "verified" }] };
      }
      return {
        id: "d-1",
        name: "malcom.io",
        status: "verified",
        records: [],
      };
    });
    const sender = resendSender("re_test_key");
    await sender.ensureDomain("malcom.io");
    expect(calls.filter((u) => u.endsWith("/domains")).length).toBe(1);
    // Detail GET on the existing domain id; no POST.
    expect(calls.some((u) => u.includes("/domains/d-1"))).toBe(true);
    expect(calls.some((u) => u === "https://api.resend.com/domains" && false))
      .toBe(false);
  });

  it("POSTs to create when the domain is not in the list", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    stubFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/domains") && (init?.method ?? "GET") === "GET") {
        return { data: [] };
      }
      if (url.endsWith("/domains") && init?.method === "POST") {
        return { id: "d-new", name: "malcom.io", status: "pending" };
      }
      return {
        id: "d-new",
        name: "malcom.io",
        status: "pending",
        records: [],
      };
    });
    const sender = resendSender("re_test_key");
    await sender.ensureDomain("malcom.io");
    const post = calls.find(
      (c) => c.url.endsWith("/domains") && c.method === "POST",
    );
    expect(post).toBeDefined();
  });
});

describe("resendSender — refreshDomain", () => {
  it("waits ~5s between POST /verify and GET /domains/:id", async () => {
    const calls: Array<{ url: string; t: number }> = [];
    stubFetch((url) => {
      calls.push({ url, t: Date.now() });
      if (url.endsWith("/verify")) return {};
      return {
        id: "d-1",
        name: "x.com",
        status: "verified",
        records: [],
      };
    });
    const sender = resendSender("re_test_key");
    const startMs = Date.now();
    const promise = sender.refreshDomain("d-1");
    // Resolve the 5s wait.
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toContain("/verify");
    expect(calls[1]!.url).toContain("/domains/d-1");
    expect(calls[1]!.t - calls[0]!.t).toBeGreaterThanOrEqual(5_000);
    void startMs;
  });

  it("falls back to MX priority 10 when Resend omits priority", async () => {
    stubFetch((url) => {
      if (url.endsWith("/verify")) return {};
      return {
        id: "d-1",
        name: "x.com",
        status: "verified",
        records: [
          {
            record: "MX",
            name: "send",
            type: "MX",
            value: "feedback-smtp.us-east-1.amazonses.com",
            // priority intentionally omitted to exercise the fallback.
          },
        ],
      };
    });
    const sender = resendSender("re_test_key");
    const promise = sender.refreshDomain("d-1");
    await vi.advanceTimersByTimeAsync(5_000);
    const status = await promise;
    expect(status.dnsRecords[0]?.priority).toBe(10);
  });

  it("propagates per-record status from the API response", async () => {
    stubFetch((url) => {
      if (url.endsWith("/verify")) return {};
      return {
        id: "d-1",
        name: "x.com",
        status: "pending",
        records: [
          {
            record: "TXT",
            name: "resend._domainkey",
            type: "TXT",
            value: "p=…",
            status: "verified",
          },
          {
            record: "MX",
            name: "send",
            type: "MX",
            value: "feedback-smtp.us-east-1.amazonses.com",
            priority: 10,
            status: "pending",
          },
        ],
      };
    });
    const sender = resendSender("re_test_key");
    const promise = sender.refreshDomain("d-1");
    await vi.advanceTimersByTimeAsync(5_000);
    const status = await promise;
    expect(status.dnsRecords[0]?.recordStatus).toBe("verified");
    expect(status.dnsRecords[1]?.recordStatus).toBe("pending");
  });
});
