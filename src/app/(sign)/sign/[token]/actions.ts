"use server";

import { headers } from "next/headers";
import { logError } from "@/lib/logger";
import {
  issueSignOtp,
  verifySignOtp,
  recordSignDecision,
  type SignFailReason,
} from "@/lib/proposals/sign-service";

/**
 * PUBLIC server actions for the sign-off page (SAL-036). There is no session
 * here — deliberately NOT wrapped in runSafeAction (which requires an
 * authenticated user). Authorization is the token itself, validated inside
 * the sign-service on every call. Results are small serializable objects;
 * failures return coarse reasons and never leak internals.
 */

export interface PublicActionResult {
  ok: boolean;
  reason?: SignFailReason | "error";
  sentTo?: string;
}

function invalidInput(): PublicActionResult {
  return { ok: false, reason: "error" };
}

export async function requestSignOtpAction(
  token: unknown,
): Promise<PublicActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) {
    return invalidInput();
  }
  try {
    const result = await issueSignOtp(token);
    return result.ok
      ? { ok: true, sentTo: result.value.sentTo }
      : { ok: false, reason: result.reason };
  } catch (err) {
    logError(err, { action: "requestSignOtpAction" });
    return { ok: false, reason: "error" };
  }
}

export async function verifySignOtpAction(
  token: unknown,
  code: unknown,
): Promise<PublicActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) {
    return invalidInput();
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return { ok: false, reason: "otp_invalid" };
  }
  try {
    const result = await verifySignOtp(token, code);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (err) {
    logError(err, { action: "verifySignOtpAction" });
    return { ok: false, reason: "error" };
  }
}

export interface SubmitDecisionPayload {
  decision: "accepted" | "declined";
  signerName: string;
  signerTitle: string;
  signatureTyped: string;
  selectedLineItemIds: string[];
}

export async function submitSignDecisionAction(
  token: unknown,
  payload: unknown,
): Promise<PublicActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) {
    return invalidInput();
  }
  const p = payload as Partial<SubmitDecisionPayload> | null;
  if (
    !p ||
    (p.decision !== "accepted" && p.decision !== "declined") ||
    typeof p.signerName !== "string" ||
    p.signerName.trim().length === 0 ||
    p.signerName.length > 200 ||
    typeof p.signerTitle !== "string" ||
    p.signerTitle.length > 200 ||
    typeof p.signatureTyped !== "string" ||
    p.signatureTyped.length > 200 ||
    !Array.isArray(p.selectedLineItemIds) ||
    p.selectedLineItemIds.length > 100 ||
    p.selectedLineItemIds.some((id) => typeof id !== "string")
  ) {
    return invalidInput();
  }
  // Accepting requires a typed signature; declining doesn't.
  if (p.decision === "accepted" && p.signatureTyped.trim().length === 0) {
    return invalidInput();
  }

  try {
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    const ipAddress = forwardedFor?.split(",")[0]?.trim() || null;
    const userAgent = headerList.get("user-agent");

    const result = await recordSignDecision(token, {
      decision: p.decision,
      signerName: p.signerName.trim(),
      signerTitle: p.signerTitle.trim() || null,
      signatureTyped: p.signatureTyped.trim() || null,
      selectedLineItemIds: p.selectedLineItemIds as string[],
      ipAddress,
      userAgent,
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (err) {
    logError(err, { action: "submitSignDecisionAction" });
    return { ok: false, reason: "error" };
  }
}
