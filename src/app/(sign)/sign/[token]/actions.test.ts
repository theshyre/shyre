import { describe, it, expect, vi, beforeEach } from "vitest";

const issueMock = vi.fn();
const verifyMock = vi.fn();
const decideMock = vi.fn();
vi.mock("@/lib/proposals/sign-service", () => ({
  issueSignOtp: (...args: unknown[]) => issueMock(...args),
  verifySignOtp: (...args: unknown[]) => verifyMock(...args),
  recordSignDecision: (...args: unknown[]) => decideMock(...args),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

let headerMap: Map<string, string>;
const cookieSetMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => headerMap.get(key) ?? null,
  }),
  cookies: async () => ({
    set: (...args: unknown[]) => cookieSetMock(...args),
  }),
}));

import {
  requestSignOtpAction,
  verifySignOtpAction,
  submitSignDecisionAction,
} from "./actions";

const TOKEN = "a".repeat(43);

beforeEach(() => {
  issueMock.mockReset();
  verifyMock.mockReset();
  decideMock.mockReset();
  logErrorMock.mockReset();
  cookieSetMock.mockReset();
  headerMap = new Map([
    ["x-forwarded-for", "203.0.113.5, 10.0.0.1"],
    ["user-agent", "vitest-agent"],
  ]);
});

describe("requestSignOtpAction", () => {
  it("passes valid tokens through and returns sentTo", async () => {
    issueMock.mockResolvedValue({ ok: true, value: { sentTo: "j@x.com" } });
    expect(await requestSignOtpAction(TOKEN)).toEqual({
      ok: true,
      sentTo: "j@x.com",
    });
  });

  it("rejects malformed tokens without touching the service", async () => {
    expect(await requestSignOtpAction("")).toEqual({ ok: false, reason: "error" });
    expect(await requestSignOtpAction("x".repeat(200))).toEqual({
      ok: false,
      reason: "error",
    });
    expect(await requestSignOtpAction(42)).toEqual({ ok: false, reason: "error" });
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("maps service failures to coarse reasons and never throws", async () => {
    issueMock.mockResolvedValue({ ok: false, reason: "otp_cooldown" });
    expect(await requestSignOtpAction(TOKEN)).toEqual({
      ok: false,
      reason: "otp_cooldown",
    });

    issueMock.mockRejectedValue(new Error("db down"));
    expect(await requestSignOtpAction(TOKEN)).toEqual({
      ok: false,
      reason: "error",
    });
    expect(logErrorMock).toHaveBeenCalled();
  });
});

describe("verifySignOtpAction", () => {
  it("rejects non-6-digit codes without calling the service", async () => {
    expect(await verifySignOtpAction(TOKEN, "12345")).toEqual({
      ok: false,
      reason: "otp_invalid",
    });
    expect(await verifySignOtpAction(TOKEN, "abcdef")).toEqual({
      ok: false,
      reason: "otp_invalid",
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("verifies well-formed codes and sets the httpOnly view-session cookie", async () => {
    verifyMock.mockResolvedValue({
      ok: true,
      value: { verified: true, viewSession: "sess-secret-value" },
    });
    expect(await verifySignOtpAction(TOKEN, "123456")).toEqual({ ok: true });
    expect(verifyMock).toHaveBeenCalledWith(TOKEN, "123456");
    // SAL-045: the browser's view session is set as an httpOnly, /sign-scoped
    // cookie carrying the raw secret the service handed back.
    expect(cookieSetMock).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieSetMock.mock.calls[0]!;
    expect(name).toMatch(/^sv_/);
    expect(value).toBe("sess-secret-value");
    expect((opts as { httpOnly?: boolean }).httpOnly).toBe(true);
    expect((opts as { sameSite?: string }).sameSite).toBe("lax");
    expect((opts as { path?: string }).path).toBe("/sign");
  });

  it("sets no cookie when verification fails", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "otp_invalid" });
    expect(await verifySignOtpAction(TOKEN, "123456")).toEqual({
      ok: false,
      reason: "otp_invalid",
    });
    expect(cookieSetMock).not.toHaveBeenCalled();
  });
});

describe("submitSignDecisionAction", () => {
  const payload = {
    decision: "accepted" as const,
    signerName: "Jordan Chen",
    signerTitle: "CTO",
    signatureTyped: "Jordan Chen",
    selectedLineItemIds: ["li-1"],
  };

  it("threads IP (first forwarded hop) + UA into the decision record", async () => {
    decideMock.mockResolvedValue({ ok: true, value: { decision: "accepted" } });
    expect(await submitSignDecisionAction(TOKEN, payload)).toEqual({ ok: true });
    expect(decideMock).toHaveBeenCalledWith(TOKEN, {
      decision: "accepted",
      signerName: "Jordan Chen",
      signerTitle: "CTO",
      signatureTyped: "Jordan Chen",
      selectedLineItemIds: ["li-1"],
      ipAddress: "203.0.113.5",
      userAgent: "vitest-agent",
    });
  });

  it("rejects an accept without a typed signature", async () => {
    expect(
      await submitSignDecisionAction(TOKEN, { ...payload, signatureTyped: "  " }),
    ).toEqual({ ok: false, reason: "error" });
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("rejects garbage payloads (shape, sizes, unknown decision)", async () => {
    expect(await submitSignDecisionAction(TOKEN, null)).toEqual({
      ok: false,
      reason: "error",
    });
    expect(
      await submitSignDecisionAction(TOKEN, { ...payload, decision: "maybe" }),
    ).toEqual({ ok: false, reason: "error" });
    expect(
      await submitSignDecisionAction(TOKEN, {
        ...payload,
        signerName: "x".repeat(300),
      }),
    ).toEqual({ ok: false, reason: "error" });
    expect(
      await submitSignDecisionAction(TOKEN, {
        ...payload,
        selectedLineItemIds: [42],
      }),
    ).toEqual({ ok: false, reason: "error" });
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("allows a decline without a signature", async () => {
    decideMock.mockResolvedValue({ ok: true, value: { decision: "declined" } });
    expect(
      await submitSignDecisionAction(TOKEN, {
        ...payload,
        decision: "declined",
        signatureTyped: "",
        selectedLineItemIds: [],
      }),
    ).toEqual({ ok: true });
  });

  it("maps service refusals through", async () => {
    decideMock.mockResolvedValue({ ok: false, reason: "otp_required" });
    expect(await submitSignDecisionAction(TOKEN, payload)).toEqual({
      ok: false,
      reason: "otp_required",
    });
  });
});
