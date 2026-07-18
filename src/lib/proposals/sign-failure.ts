/**
 * Coarse sign-service failure reason → i18n key (relative to the
 * `proposals.sign` namespace). Extracted because the mapping was duplicated
 * verbatim in sign-gate.tsx and sign-experience.tsx — the drift-prone
 * dual-maintenance class the 2026-07-17 architecture review flagged.
 * Components call `t(signFailureKey(reason))`.
 */
import type { SignFailReason } from "./sign-service";

export function signFailureKey(
  reason: SignFailReason | "error" | undefined,
): string {
  switch (reason) {
    case "otp_invalid":
      return "errors.otpInvalid";
    case "otp_expired":
      return "errors.otpExpired";
    case "otp_locked":
      return "errors.otpLocked";
    case "otp_cooldown":
      return "errors.otpCooldown";
    case "otp_required":
      return "errors.otpRequired";
    case "consumed":
      return "errors.consumed";
    case "invalid_selection":
      return "errors.invalidSelection";
    case "offer_expired":
      return "errors.offerExpired";
    case "awaiting_primary":
      return "awaitingPrimaryNote";
    case "email_failed":
      return "errors.emailFailed";
    default:
      return "errors.generic";
  }
}
