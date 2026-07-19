import { describe, it, expect } from "vitest";
import { signFailureKey } from "./sign-failure";

describe("signFailureKey", () => {
  it("maps every known reason to its namespace key", () => {
    expect(signFailureKey("otp_invalid")).toBe("errors.otpInvalid");
    expect(signFailureKey("otp_expired")).toBe("errors.otpExpired");
    expect(signFailureKey("otp_locked")).toBe("errors.otpLocked");
    expect(signFailureKey("otp_cooldown")).toBe("errors.otpCooldown");
    expect(signFailureKey("otp_required")).toBe("errors.otpRequired");
    expect(signFailureKey("awaiting_primary")).toBe("awaitingPrimaryNote");
    expect(signFailureKey("consumed")).toBe("errors.consumed");
    expect(signFailureKey("invalid_selection")).toBe("errors.invalidSelection");
    expect(signFailureKey("offer_expired")).toBe("errors.offerExpired");
    expect(signFailureKey("email_failed")).toBe("errors.emailFailed");
  });
  it("falls back to the generic error for unknown/undefined", () => {
    expect(signFailureKey(undefined)).toBe("errors.generic");
    expect(signFailureKey("error")).toBe("errors.generic");
    expect(signFailureKey("not_found")).toBe("errors.generic");
  });
});
