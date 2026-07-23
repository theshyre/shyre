import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { unwrapEmbed } from "@/lib/supabase/embed";
import { sendSignoffEmail } from "@/lib/messaging/send-signoff";
import {
  generateSignToken,
  generateOtpCode,
  hashOtp,
  sha256Hex,
  digestsEqual,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MINUTES,
  VIEW_SESSION_TTL_HOURS,
} from "./tokens";

/**
 * Public sign-off service — the session-less signing surface for the generic
 * document sign-off. A faithful, simplified mirror of the proposals sign
 * service (SAL-036/037/045/046): sha256 token at rest, atomic OTP counter,
 * per-browser view-session cookie gate, consume-first race guard, immutable
 * content-hashed acceptance. Document-shaped — no line items / pricing /
 * subset-binding: every signer signs the WHOLE document.
 */

export type SignFailReason =
  | "not_found"
  | "expired"
  | "revoked"
  | "consumed"
  | "otp_required"
  | "otp_expired"
  | "otp_invalid"
  | "otp_locked"
  | "otp_cooldown"
  | "invalid_state"
  | "email_failed"
  | "session_failed";

export type SignResult<T> = { ok: true; value: T } | { ok: false; reason: SignFailReason };

type SignTheme = "light" | "dark" | "warm";
function resolveSignTheme(v: unknown): SignTheme {
  return v === "dark" || v === "warm" ? v : "light";
}

interface TokenRow {
  id: string;
  document_id: string;
  team_id: string;
  signer_id: string | null;
  signer_email: string;
  signer_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  first_viewed_at: string | null;
  otp_code_hash: string | null;
  otp_expires_at: string | null;
  otp_attempts: number;
  otp_verified_at: string | null;
  view_session_hash?: string | null;
  view_session_expires_at?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Mask a signer email for the gate ("jo•••@acme.com"). Code-point safe. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const points = Array.from(local);
  const shown = points.slice(0, Math.min(2, Math.max(1, points.length - 1))).join("");
  return `${shown}•••@${domain}`;
}

/** A live, un-expired view session for THIS token (constant-time, fail-closed). */
function hasValidViewSession(token: TokenRow, cookieValue: string | null): boolean {
  if (!cookieValue) return false;
  if (!token.view_session_hash || !token.view_session_expires_at) return false;
  if (new Date(token.view_session_expires_at).getTime() < Date.now()) return false;
  return digestsEqual(sha256Hex(cookieValue), token.view_session_hash);
}

function logReadError(
  error: { code?: string; message?: string } | null,
  action: string,
  teamId?: string,
): void {
  if (!error || error.code === "PGRST116") return;
  logError(new Error(`${action} read failed: ${error.message ?? "unknown"}`), {
    ...(teamId ? { teamId } : {}),
    action,
  });
}

async function findValidToken(admin: Admin, rawToken: string): Promise<SignResult<TokenRow>> {
  const { data, error } = await admin
    .from("signoff_tokens")
    .select("*")
    .eq("token_hash", sha256Hex(rawToken))
    .single();
  logReadError(error, "signoffSign.findValidToken");
  const token = data as TokenRow | null;
  if (!token) return { ok: false, reason: "not_found" };
  if (token.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(token.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, value: token };
}

async function insertEvent(
  admin: Admin,
  token: TokenRow,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("signoff_events").insert({
    document_id: token.document_id,
    team_id: token.team_id,
    event_type: eventType,
    actor_user_id: null,
    actor_label: `${token.signer_name ?? token.signer_email} (signer)`,
    metadata,
  });
  if (error) {
    logError(new Error(`signoff_events insert failed: ${error.message}`), {
      teamId: token.team_id,
      action: "signoffSign.insertEvent",
    });
  }
}

function isOtpPending(token: TokenRow): boolean {
  return (
    !!token.otp_code_hash &&
    !!token.otp_expires_at &&
    new Date(token.otp_expires_at).getTime() > Date.now() &&
    token.otp_attempts < MAX_OTP_ATTEMPTS
  );
}

export interface SignGateInfo {
  verified: boolean;
  businessName: string | null;
  businessLogoUrl: string | null;
  brandColor: string | null;
  wordmarkPrimary: string | null;
  wordmarkSecondary: string | null;
  maskedEmail: string;
  otpPending: boolean;
  decided: boolean;
  signTheme: SignTheme;
}

async function loadBranding(admin: Admin, teamId: string): Promise<{
  businessName: string | null;
  businessLogoUrl: string | null;
  brandColor: string | null;
  wordmarkPrimary: string | null;
  wordmarkSecondary: string | null;
}> {
  const { data, error } = await admin
    .from("team_settings")
    .select("business_name, logo_url, brand_color, wordmark_primary, wordmark_secondary")
    .eq("team_id", teamId)
    .single();
  logReadError(error, "signoffSign.loadBranding", teamId);
  return {
    businessName: (data?.business_name as string | null) ?? null,
    businessLogoUrl: (data?.logo_url as string | null) ?? null,
    brandColor: (data?.brand_color as string | null) ?? null,
    wordmarkPrimary: (data?.wordmark_primary as string | null) ?? null,
    wordmarkSecondary: (data?.wordmark_secondary as string | null) ?? null,
  };
}

/** The identity gate — NO document content until the view-session is valid. */
export async function loadSignGate(
  rawToken: string,
  cookieValue: string | null,
): Promise<SignResult<SignGateInfo>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;

  const branding = await loadBranding(admin, token.team_id);
  const { data: doc } = await admin
    .from("signoff_documents")
    .select("sign_theme")
    .eq("id", token.document_id)
    .single();

  return {
    ok: true,
    value: {
      verified: hasValidViewSession(token, cookieValue),
      signTheme: resolveSignTheme(doc?.sign_theme),
      ...branding,
      maskedEmail: maskEmail(token.signer_email),
      otpPending: isOtpPending(token),
      decided: !!token.consumed_at,
    },
  };
}

export interface SignBundle {
  documentId: string;
  title: string;
  versionLabel: string | null;
  bodyMarkdown: string;
  signTheme: SignTheme;
  signerName: string | null;
  signerRole: string | null;
  signerOrg: string | null;
  /** Whether this link already recorded a decision (terminal). */
  decided: boolean;
  decision: "signed" | "declined" | null;
  businessName: string | null;
  businessLogoUrl: string | null;
  brandColor: string | null;
  wordmarkPrimary: string | null;
  wordmarkSecondary: string | null;
  customerName: string | null;
  customerLogoUrl: string | null;
}

/** Resolve the full sign experience once verified: stamp first view, flip
 *  sent → viewed, and return the document + branding. */
export async function loadSignBundle(rawToken: string): Promise<SignResult<SignBundle>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;

  const { data: doc, error: docError } = await admin
    .from("signoff_documents")
    .select(
      "id, team_id, title, version_label, body_markdown, status, sign_theme, customers(name, logo_url)",
    )
    .eq("id", token.document_id)
    .single();
  logReadError(docError, "signoffSign.loadSignBundle", token.team_id);
  if (!doc) return { ok: false, reason: "not_found" };

  if (!token.first_viewed_at) {
    await admin
      .from("signoff_tokens")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("id", token.id);
    await insertEvent(admin, token, "viewed");
    if (doc.status === "sent") {
      await admin
        .from("signoff_documents")
        .update({ status: "viewed" })
        .eq("id", token.document_id);
    }
  }

  const { data: signer } = await admin
    .from("signoff_signers")
    .select("name, role_label, org_label")
    .eq("id", token.signer_id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();

  const { data: existing } = await admin
    .from("signoff_acceptances")
    .select("decision")
    .eq("document_id", token.document_id)
    .eq("signer_id", token.signer_id)
    .maybeSingle();

  const branding = await loadBranding(admin, token.team_id);
  type Cust = { name: string; logo_url: string | null };
  const customer = unwrapEmbed(doc.customers as Cust | Cust[] | null);

  return {
    ok: true,
    value: {
      documentId: token.document_id,
      title: doc.title as string,
      versionLabel: (doc.version_label as string | null) ?? null,
      bodyMarkdown: doc.body_markdown as string,
      signTheme: resolveSignTheme(doc.sign_theme),
      signerName: (signer?.name as string | null) ?? token.signer_name,
      signerRole: (signer?.role_label as string | null) ?? null,
      signerOrg: (signer?.org_label as string | null) ?? null,
      decided: !!token.consumed_at,
      decision: (existing?.decision as "signed" | "declined" | null) ?? null,
      ...branding,
      customerName: customer?.name ?? null,
      customerLogoUrl: customer?.logo_url ?? null,
    },
  };
}

/** Issue an emailed one-time code (60s cooldown). */
export async function issueSignOtp(rawToken: string): Promise<SignResult<{ sentTo: string }>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;

  if (token.otp_expires_at) {
    const issuedAt = new Date(token.otp_expires_at).getTime() - OTP_TTL_MINUTES * 60_000;
    if (Date.now() - issuedAt < 60_000) return { ok: false, reason: "otp_cooldown" };
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
  await admin
    .from("signoff_tokens")
    .update({
      otp_code_hash: hashOtp(token.id, code),
      otp_expires_at: expiresAt.toISOString(),
      otp_attempts: 0,
      otp_verified_at: null,
    })
    .eq("id", token.id);

  try {
    await sendSignoffEmail(admin, {
      teamId: token.team_id,
      userId: null,
      documentId: token.document_id,
      kind: "signoff_otp",
      toEmail: token.signer_email,
      subject: "Your sign-off code",
      bodyHtml: `<p>Your one-time code to sign this document is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.</p>`,
      bodyText: `Your one-time code to sign this document is: ${code}\n\nIt expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
    });
  } catch (err) {
    logError(err, { teamId: token.team_id, action: "signoffSign.issueSignOtp" });
    return { ok: false, reason: "email_failed" };
  }

  await insertEvent(admin, token, "otp_sent");
  return { ok: true, value: { sentTo: token.signer_email } };
}

/** Verify a code — atomic attempt counting, one-shot code, mint view-session. */
export async function verifySignOtp(
  rawToken: string,
  code: string,
): Promise<SignResult<{ verified: true; viewSession: string }>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;
  if (!token.otp_code_hash || !token.otp_expires_at) return { ok: false, reason: "otp_required" };
  if (new Date(token.otp_expires_at).getTime() < Date.now()) return { ok: false, reason: "otp_expired" };

  const { data: attempts } = await admin.rpc("signoff_otp_attempt", { p_token_id: token.id });
  if (attempts == null) return { ok: false, reason: "otp_locked" };

  if (!digestsEqual(hashOtp(token.id, code), token.otp_code_hash)) {
    await insertEvent(admin, token, "otp_failed", { attempts });
    return {
      ok: false,
      reason: (attempts as number) >= MAX_OTP_ATTEMPTS ? "otp_locked" : "otp_invalid",
    };
  }

  const viewSession = generateSignToken();
  const viewExpiresAt = new Date(Date.now() + VIEW_SESSION_TTL_HOURS * 3_600_000);
  const { error: persistError } = await admin
    .from("signoff_tokens")
    .update({
      otp_verified_at: new Date().toISOString(),
      view_session_hash: viewSession.hash,
      view_session_expires_at: viewExpiresAt.toISOString(),
      otp_code_hash: null,
      otp_expires_at: null,
    })
    .eq("id", token.id);
  if (persistError) {
    logError(new Error(`view-session persist failed: ${persistError.message}`), {
      teamId: token.team_id,
      action: "signoffSign.verifySignOtp",
    });
    return { ok: false, reason: "session_failed" };
  }
  await insertEvent(admin, token, "otp_verified");
  return { ok: true, value: { verified: true, viewSession: viewSession.raw } };
}

export interface SignDecisionInput {
  decision: "signed" | "declined";
  signerName: string;
  signerTitle: string | null;
  signatureTyped: string | null;
  signatureMeaning: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  viewSession: string | null;
}

/** Record the signer's decision: consume-first race guard + immutable
 *  content-hashed acceptance. `all`-mode completes when every signer has
 *  signed; a decline ends the sign-off. */
export async function recordSignDecision(
  rawToken: string,
  input: SignDecisionInput,
): Promise<SignResult<{ decision: "signed" | "declined"; completed: boolean }>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;
  if (token.consumed_at) return { ok: false, reason: "consumed" };
  if (!token.otp_verified_at) return { ok: false, reason: "otp_required" };
  // SAL-046: signing needs the SAME per-browser proof as viewing.
  if (!hasValidViewSession(token, input.viewSession)) return { ok: false, reason: "otp_required" };

  const { data: doc, error: docError } = await admin
    .from("signoff_documents")
    .select("id, team_id, title, version_label, body_markdown, status, signing_mode")
    .eq("id", token.document_id)
    .single();
  logReadError(docError, "signoffSign.recordSignDecision", token.team_id);
  if (!doc) return { ok: false, reason: "not_found" };
  // A terminal document can't accept more signatures.
  if (["completed", "declined", "superseded", "canceled"].includes(doc.status as string)) {
    return { ok: false, reason: "invalid_state" };
  }

  // Frozen snapshot of exactly what was signed, stable key order → reproducible
  // hash. Independent of any later document change.
  const snapshot = {
    document_id: token.document_id,
    title: doc.title,
    version_label: doc.version_label ?? null,
    body_markdown: doc.body_markdown,
    signer_name: input.signerName,
    signer_title: input.signerTitle,
    signature_meaning: input.signatureMeaning,
    decision: input.decision,
  };
  const snapshotJson = JSON.stringify(snapshot);
  const contentSha256 = sha256Hex(snapshotJson);

  // Consume-FIRST (SAL-038): one concurrent submit wins; the partial unique
  // index is the DB backstop.
  const { data: consumed } = await admin
    .from("signoff_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", token.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) return { ok: false, reason: "consumed" };

  const { error: insertError } = await admin.from("signoff_acceptances").insert({
    document_id: token.document_id,
    team_id: token.team_id,
    signer_id: token.signer_id,
    decision: input.decision,
    signer_name: input.signerName,
    signer_title: input.signerTitle,
    signer_email: token.signer_email,
    signature_typed: input.signatureTyped,
    signature_meaning: input.signatureMeaning,
    content_snapshot: snapshot,
    content_sha256: contentSha256,
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    otp_verified_at: token.otp_verified_at,
  });
  if (insertError) {
    // Roll back the consume so the link stays retryable.
    await admin.from("signoff_tokens").update({ consumed_at: null }).eq("id", token.id);
    logError(new Error(`signoff_acceptances insert failed: ${insertError.message}`), {
      teamId: token.team_id,
      action: "signoffSign.recordSignDecision",
    });
    return { ok: false, reason: "session_failed" };
  }

  await insertEvent(admin, token, input.decision === "declined" ? "declined" : "signed");

  // Completion. A decline ends the sign-off. A signature completes it when
  // mode='first', or when every rostered signer has now signed.
  let completed = false;
  if (input.decision === "declined") {
    await admin.from("signoff_documents").update({ status: "declined" }).eq("id", token.document_id);
  } else {
    const mode = (doc.signing_mode as string) ?? "all";
    if (mode === "first") {
      completed = true;
    } else {
      const { count: signerCount } = await admin
        .from("signoff_signers")
        .select("id", { count: "exact", head: true })
        .eq("document_id", token.document_id);
      const { count: signedCount } = await admin
        .from("signoff_acceptances")
        .select("id", { count: "exact", head: true })
        .eq("document_id", token.document_id)
        .eq("decision", "signed");
      completed = (signedCount ?? 0) >= (signerCount ?? 0) && (signerCount ?? 0) > 0;
    }
    if (completed) {
      await admin.from("signoff_documents").update({ status: "completed" }).eq("id", token.document_id);
      await insertEvent(admin, token, "completed");
    }
  }

  return { ok: true, value: { decision: input.decision, completed } };
}
