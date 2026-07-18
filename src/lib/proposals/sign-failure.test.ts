import { describe, it, expect } from "vitest";
import { signFailureKey } from "./sign-failure";

describe("signFailureKey", () => {
  it("maps every known reason to its namespace key", () => {
    expect(signFailureKey("otp_invalid")).toBe("errors.otpInvalid");
    expect(signFailureKey("otp_locked")).toBe("errors.otpLocked");
    expect(signFailureKey("awaiting_primary")).toBe("awaitingPrimaryNote");
    expect(signFailureKey("consumed")).toBe("errors.consumed");
  });
  it("falls back to the generic error for unknown/undefined", () => {
    expect(signFailureKey(undefined)).toBe("errors.generic");
    expect(signFailureKey("error")).toBe("errors.generic");
    expect(signFailureKey("not_found")).toBe("errors.generic");
  });
});
