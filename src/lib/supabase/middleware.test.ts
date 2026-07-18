import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";

// Unauthenticated: no session. Every request hits the redirect gate.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { updateSession } from "./middleware";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

/** True when updateSession redirected the request to /login. */
async function redirectsToLogin(path: string): Promise<boolean> {
  const res = await updateSession(
    new NextRequest(`https://shyre.example${path}`),
  );
  const location = res.headers.get("location");
  return res.status === 307 && !!location && location.endsWith("/login");
}

describe("updateSession auth gate", () => {
  it("redirects an unauthenticated dashboard request to /login", async () => {
    expect(await redirectsToLogin("/proposals")).toBe(true);
    expect(await redirectsToLogin("/dashboard")).toBe(true);
  });

  it("does NOT redirect the public sign-off surface", async () => {
    expect(await redirectsToLogin("/sign")).toBe(false);
    expect(await redirectsToLogin("/sign/some-token")).toBe(false);
  });

  it("does NOT redirect the Resend delivery webhook (it self-authenticates via HMAC)", async () => {
    // Regression guard: this exact path 307-ing to /login is why Resend
    // disabled the webhook — every delivery event failed for ~2 months.
    expect(await redirectsToLogin("/api/messaging/webhook/resend")).toBe(false);
  });

  it("STILL redirects other /api routes (session-gated user exports)", async () => {
    expect(await redirectsToLogin("/api/invoices/csv")).toBe(true);
    expect(await redirectsToLogin("/api/messaging/webhook/resendX")).toBe(true);
  });

  it("does NOT redirect the integrations API surface (self-authenticates via PAT — SAL-051)", async () => {
    expect(await redirectsToLogin("/api/v1")).toBe(false);
    expect(await redirectsToLogin("/api/v1/timer")).toBe(false);
    expect(await redirectsToLogin("/api/v1/timer/start")).toBe(false);
    expect(await redirectsToLogin("/api/mcp")).toBe(false);
    expect(await redirectsToLogin("/api/mcp/sse")).toBe(false);
  });

  it("exact-segment discipline: near-miss paths STILL redirect (SAL-039)", async () => {
    expect(await redirectsToLogin("/api/v10/timer")).toBe(true);
    expect(await redirectsToLogin("/api/v1x")).toBe(true);
    expect(await redirectsToLogin("/api/mcpx")).toBe(true);
  });
});
