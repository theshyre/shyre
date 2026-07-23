"use server";

import { headers, cookies } from "next/headers";
import { logError } from "@/lib/logger";
import {
  issueSignOtp,
  verifySignOtp,
  recordSignDecision,
  type SignFailReason,
} from "@/lib/sign/signoff-sign-service";
import { viewSessionCookieName, VIEW_SESSION_TTL_HOURS } from "@/lib/sign/tokens";

/**
 * PUBLIC server actions for the document sign-off page (SAL-036 lineage).
 * No session — deliberately NOT wrapped in runSafeAction. Authorization is the
 * token, validated inside the sign-service on every call. Coarse failure
 * reasons; no internals leak.
 */

const MEANINGS = new Set(["author", "reviewer", "approver"]);

export interface PublicActionResult {
  ok: boolean;
  reason?: SignFailReason | "error";
}

function invalidInput(): PublicActionResult {
  return { ok: false, reason: "error" };
}

export async function requestSignoffOtpAction(token: unknown): Promise<PublicActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) return invalidInput();
  try {
    const result = await issueSignOtp(token);
    // Deliberately do NOT return the destination email: the masked gate
    // (SAL-045/046) exists so an unverified link holder can't read the full
    // recipient — forwarding it in this response would defeat that. SAL-065.
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (err) {
    logError(err, { action: "requestSignoffOtpAction" });
    return { ok: false, reason: "error" };
  }
}

export async function verifySignoffOtpAction(
  token: unknown,
  code: unknown,
): Promise<PublicActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) return invalidInput();
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return { ok: false, reason: "otp_invalid" };
  try {
    const result = await verifySignOtp(token, code);
    if (!result.ok) return { ok: false, reason: result.reason };
    const cookieStore = await cookies();
    cookieStore.set(viewSessionCookieName(token), result.value.viewSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/signoff",
      maxAge: VIEW_SESSION_TTL_HOURS * 3600,
    });
    return { ok: true };
  } catch (err) {
    logError(err, { action: "verifySignoffOtpAction" });
    return { ok: false, reason: "error" };
  }
}

export interface SubmitSignoffPayload {
  decision: "signed" | "declined";
  signerName: string;
  signerTitle: string;
  signatureTyped: string;
  signatureMeaning: string;
}

export async function submitSignoffDecisionAction(
  token: unknown,
  payload: unknown,
): Promise<PublicActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > 128) return invalidInput();
  const p = payload as Partial<SubmitSignoffPayload> | null;
  if (
    !p ||
    (p.decision !== "signed" && p.decision !== "declined") ||
    typeof p.signerName !== "string" ||
    p.signerName.trim().length === 0 ||
    p.signerName.length > 200 ||
    typeof p.signerTitle !== "string" ||
    p.signerTitle.length > 200 ||
    typeof p.signatureTyped !== "string" ||
    p.signatureTyped.length > 200 ||
    typeof p.signatureMeaning !== "string" ||
    (p.signatureMeaning !== "" && !MEANINGS.has(p.signatureMeaning))
  ) {
    return invalidInput();
  }
  // Signing requires a typed signature AND an explicit signature meaning
  // (author/reviewer/approver) — the Part-11 manifestation is server-enforced,
  // not just the client attestation gate. Declining requires neither.
  if (p.decision === "signed") {
    if (p.signatureTyped.trim().length === 0) return invalidInput();
    if (!MEANINGS.has(p.signatureMeaning)) return invalidInput();
  }

  try {
    const headerList = await headers();
    const ipAddress = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = headerList.get("user-agent");
    const cookieStore = await cookies();
    const viewSession = cookieStore.get(viewSessionCookieName(token))?.value ?? null;

    const result = await recordSignDecision(token, {
      decision: p.decision,
      signerName: p.signerName.trim(),
      signerTitle: p.signerTitle.trim() || null,
      signatureTyped: p.signatureTyped.trim() || null,
      signatureMeaning: p.signatureMeaning || null,
      ipAddress,
      userAgent,
      viewSession,
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (err) {
    logError(err, { action: "submitSignoffDecisionAction" });
    return { ok: false, reason: "error" };
  }
}
