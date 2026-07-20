// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The OAuth/PKCE callback is hand-rolled open-redirect defense: the
 * `next` query param is attacker-influenceable (it rides through the
 * login flow as a plain query string), so `safeNext` must collapse
 * every cross-origin shape to "/". These tests enumerate the classic
 * bypass shapes — protocol-relative, backslash, absolute URL — and pin
 * that a session is exchanged before any redirect away from /login.
 */

const exchangeCodeForSessionMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) =>
        exchangeCodeForSessionMock(...args),
    },
  }),
}));

import { GET } from "./route";

const ORIGIN = "https://shyre.test";

function callbackRequest(params: Record<string, string>): Request {
  const url = new URL(`${ORIGIN}/auth/callback`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

beforeEach(() => {
  exchangeCodeForSessionMock.mockReset();
  exchangeCodeForSessionMock.mockResolvedValue({ error: null });
});

describe("auth callback — happy paths", () => {
  it("exchanges the code and lands on / when no next is given", async () => {
    const res = await GET(callbackRequest({ code: "auth-code-1" }));
    expect(exchangeCodeForSessionMock).toHaveBeenCalledExactlyOnceWith(
      "auth-code-1",
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
  });

  it("preserves a legitimate same-origin path including its query string", async () => {
    const res = await GET(
      callbackRequest({ code: "auth-code-2", next: "/invoices?x=1" }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/invoices?x=1`);
  });
});

describe("auth callback — failure paths", () => {
  it("redirects to /login when no code is present, without touching Supabase", async () => {
    const res = await GET(callbackRequest({}));
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
  });

  it("redirects to /login when the code exchange fails — even with a valid next", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      error: { message: "invalid code" },
    });
    const res = await GET(
      callbackRequest({ code: "bad-code", next: "/invoices" }),
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
  });
});

describe("auth callback — open-redirect defense (safeNext)", () => {
  // Every shape below must collapse to "/" on the app's own origin.
  // The session exchange still succeeds — the user is logged in, just
  // never bounced off-site.
  const bypassShapes: Array<[label: string, next: string]> = [
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/phish"],
    ["protocol-relative with trailing backslash host trick", "//evil.com\\@shyre.test"],
    ["backslash-prefixed (browsers normalize \\ to /)", "/\\evil.com"],
    ["double-backslash", "/\\\\evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com/login"],
    ["absolute with credentials trick", "https://shyre.test@evil.com"],
    ["schemeless host", "evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["url-encoded protocol-relative (decoded by searchParams)", "%2F%2Fevil.com"],
  ];

  for (const [label, next] of bypassShapes) {
    it(`collapses ${label} (${JSON.stringify(next)}) to /`, async () => {
      // callbackRequest uses searchParams.set, which encodes `next`
      // exactly once — the route then decodes it once via
      // searchParams.get, so the raw shape above is what safeNext sees.
      const res = await GET(callbackRequest({ code: "auth-code-3", next }));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    });
  }

  it("collapses a double-encoded protocol-relative payload to / (decodes to a non-/ prefix)", async () => {
    // %252F%252Fevil.com decodes once to %2F%2Fevil.com — not a path
    // starting with "/", so it must also land on "/". If a future
    // refactor adds a second decode, the first-decode result would be
    // "//evil.com", which the prefix checks still reject.
    const res = await GET(
      callbackRequest({ code: "auth-code-4", next: "%252F%252Fevil.com" }),
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
  });
});
