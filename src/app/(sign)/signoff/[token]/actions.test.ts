import { describe, it, expect, vi, beforeEach } from "vitest";

const issueMock = vi.fn();
const verifyMock = vi.fn();
const recordMock = vi.fn();
vi.mock("@/lib/sign/signoff-sign-service", () => ({
  issueSignOtp: (...a: unknown[]) => issueMock(...a),
  verifySignOtp: (...a: unknown[]) => verifyMock(...a),
  recordSignDecision: (...a: unknown[]) => recordMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "cookie-secret" }), set: cookieSet }),
  headers: async () => ({ get: (h: string) => (h === "x-forwarded-for" ? "9.9.9.9, 1.1.1.1" : "UA") }),
}));

import {
  requestSignoffOtpAction,
  verifySignoffOtpAction,
  submitSignoffDecisionAction,
} from "./actions";

const TOKEN = "t".repeat(43);

beforeEach(() => {
  issueMock.mockReset();
  verifyMock.mockReset();
  recordMock.mockReset();
  cookieSet.mockClear();
});

describe("requestSignoffOtpAction", () => {
  it("rejects a bad token before touching the service", async () => {
    expect(await requestSignoffOtpAction("")).toEqual({ ok: false, reason: "error" });
    expect(issueMock).not.toHaveBeenCalled();
  });
  it("forwards success with the masked destination", async () => {
    issueMock.mockResolvedValue({ ok: true, value: { sentTo: "x@y.com" } });
    expect(await requestSignoffOtpAction(TOKEN)).toEqual({ ok: true, sentTo: "x@y.com" });
  });
});

describe("verifySignoffOtpAction", () => {
  it("rejects a non-6-digit code", async () => {
    expect(await verifySignoffOtpAction(TOKEN, "12ab")).toEqual({ ok: false, reason: "otp_invalid" });
  });
  it("sets the view-session cookie on success", async () => {
    verifyMock.mockResolvedValue({ ok: true, value: { verified: true, viewSession: "vs" } });
    const r = await verifySignoffOtpAction(TOKEN, "123456");
    expect(r).toEqual({ ok: true });
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet.mock.calls[0]![2]).toMatchObject({ httpOnly: true, path: "/signoff" });
  });
  it("forwards a failure reason and sets no cookie", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "otp_locked" });
    expect(await verifySignoffOtpAction(TOKEN, "123456")).toEqual({ ok: false, reason: "otp_locked" });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("submitSignoffDecisionAction", () => {
  it("rejects a signed decision with an empty signature", async () => {
    const r = await submitSignoffDecisionAction(TOKEN, {
      decision: "signed",
      signerName: "Bret",
      signerTitle: "",
      signatureTyped: "   ",
      signatureMeaning: "approver",
    });
    expect(r).toEqual({ ok: false, reason: "error" });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown signature meaning", async () => {
    const r = await submitSignoffDecisionAction(TOKEN, {
      decision: "signed",
      signerName: "Bret",
      signerTitle: "",
      signatureTyped: "Bret",
      signatureMeaning: "supreme-overlord",
    });
    expect(r).toEqual({ ok: false, reason: "error" });
  });

  it("passes IP/UA + the view-session cookie through to the service", async () => {
    recordMock.mockResolvedValue({ ok: true, value: { decision: "signed", completed: true } });
    const r = await submitSignoffDecisionAction(TOKEN, {
      decision: "signed",
      signerName: "Bret Andre",
      signerTitle: "Principal",
      signatureTyped: "Bret Andre",
      signatureMeaning: "approver",
    });
    expect(r).toEqual({ ok: true });
    expect(recordMock).toHaveBeenCalledWith(TOKEN, expect.objectContaining({
      decision: "signed",
      signatureMeaning: "approver",
      ipAddress: "9.9.9.9",
      viewSession: "cookie-secret",
    }));
  });
});
