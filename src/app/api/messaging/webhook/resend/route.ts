import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { recordEvent } from "@/lib/messaging/outbox";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resend webhook receiver. Resend signs each delivery with an
 * HMAC-SHA256 of the raw body, keyed by the webhook secret you
 * configured in their dashboard. We verify before doing anything.
 *
 * SAL-017 logs the verification + the signature header schema.
 *
 * Events of interest (from Resend's docs):
 *   - email.sent          — provider accepted (we already record at send-time)
 *   - email.delivered     — recipient MTA accepted; flips status='delivered'
 *   - email.bounced       — hard bounce; flips status='bounced' + customers.bounced_at
 *   - email.complained    — spam complaint; flips status='complained' + customers.complained_at
 *   - email.opened/clicked — Phase 2 (engagement metrics)
 */

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    bounce?: {
      message?: string;
      subType?: string;
    };
  };
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logError(new Error("RESEND_WEBHOOK_SECRET is not set"), {
      url: request.url,
      action: "messaging.webhook.resend",
    });
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // Read raw body for signature verification — must come from
  // request.text(), not request.json(), or the bytes won't match
  // what Resend signed.
  const rawBody = await request.text();

  // Resend uses the standard webhook header schema
  // (svix-style or plain): `svix-id`, `svix-timestamp`,
  // `svix-signature`. The signature value is `v1,<base64(hmac)>`.
  // Implementation follows Resend's docs without taking on the
  // svix library as a dep — one HMAC + one constant-time compare.
  const sigHeader = request.headers.get("svix-signature");
  const sigId = request.headers.get("svix-id");
  const sigTs = request.headers.get("svix-timestamp");
  if (!sigHeader || !sigId || !sigTs) {
    return NextResponse.json(
      { error: "Missing signature headers" },
      { status: 401 },
    );
  }
  const expected = computeSignature(secret, sigId, sigTs, rawBody);
  if (!verifyAny(sigHeader, expected)) {
    return NextResponse.json(
      { error: "Signature mismatch" },
      { status: 401 },
    );
  }

  // Reject events older than 5 minutes — replay protection.
  const tsMs = Number(sigTs) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60_000) {
    return NextResponse.json(
      { error: "Stale or invalid timestamp" },
      { status: 401 },
    );
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const messageId = payload.data?.email_id;
  if (!messageId) {
    return NextResponse.json({ ok: true, ignored: "no email_id" });
  }

  // Look up the outbox row by provider_message_id. Use admin
  // client — the webhook isn't an authenticated user context.
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("message_outbox")
    .select("id, team_id, related_id, related_kind")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (!row) {
    // Could be a webhook for a message we never tracked (e.g.
    // a test send). Acknowledge so Resend stops retrying.
    return NextResponse.json({ ok: true, ignored: "unknown message" });
  }

  try {
    // recordEvent returns false when this svix-id was already
    // ingested — a Resend retry of the same logical delivery.
    // Skip the downstream side effects in that case so the
    // customer's bounced_at timestamp doesn't slide forward and
    // the activity log doesn't pick up a duplicate event row.
    const fresh = await recordEvent(
      row.id as string,
      payload.type,
      payload,
      sigId,
    );
    if (!fresh) {
      return NextResponse.json({ ok: true, ignored: "duplicate svix-id" });
    }

    // Side effects on hard bounce / complaint: flag the customer
    // so future sends skip them by default. Solo-consultant view:
    // the customer's email field's chip flips to a warning.
    if (payload.type === "email.bounced" && row.related_kind === "invoice") {
      await flagCustomerBounce(supabase, row.related_id as string | null, payload);
    }
    if (
      payload.type === "email.complained" &&
      row.related_kind === "invoice"
    ) {
      await flagCustomerComplaint(
        supabase,
        row.related_id as string | null,
      );
    }
  } catch (err) {
    logError(err, {
      teamId: row.team_id as string,
      action: "messaging.webhook.resend",
      url: request.url,
    });
    return NextResponse.json({ error: "Event handling failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function flagCustomerBounce(
  supabase: ReturnType<typeof createAdminClient>,
  invoiceId: string | null,
  payload: ResendWebhookPayload,
): Promise<void> {
  if (!invoiceId) return;
  const { data: invoice } = await supabase
    .from("invoices")
    .select("customer_id")
    .eq("id", invoiceId)
    .maybeSingle();
  const customerId = invoice?.customer_id as string | null | undefined;
  if (!customerId) return;
  await supabase
    .from("customers")
    .update({
      bounced_at: new Date().toISOString(),
      bounce_reason:
        payload.data?.bounce?.message ??
        payload.data?.bounce?.subType ??
        "Hard bounce",
    })
    .eq("id", customerId);
}

async function flagCustomerComplaint(
  supabase: ReturnType<typeof createAdminClient>,
  invoiceId: string | null,
): Promise<void> {
  if (!invoiceId) return;
  const { data: invoice } = await supabase
    .from("invoices")
    .select("customer_id")
    .eq("id", invoiceId)
    .maybeSingle();
  const customerId = invoice?.customer_id as string | null | undefined;
  if (!customerId) return;
  await supabase
    .from("customers")
    .update({ complained_at: new Date().toISOString() })
    .eq("id", customerId);
}

/**
 * Webhook signature verification.
 *
 * Implements Standard Webhooks (svix) verification: the signed
 * payload is `<id>.<timestamp>.<body>`, HMAC-SHA256 with the
 * secret, base64-encoded. Header may carry multiple comma-separated
 * `v1,<sig>` pairs (key rotation); we accept any match.
 */
function computeSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): string {
  // Resend's secrets are prefixed `whsec_`; the key bytes are the
  // base64-decoded portion after the prefix.
  const keyBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  const signedPayload = `${id}.${timestamp}.${body}`;
  return createHmac("sha256", keyBytes).update(signedPayload).digest("base64");
}

function verifyAny(headerValue: string, expected: string): boolean {
  const expBuf = Buffer.from(expected, "utf8");
  for (const part of headerValue.split(" ")) {
    const [, sig] = part.split(",");
    if (!sig) continue;
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length !== expBuf.length) continue;
    if (timingSafeEqual(sigBuf, expBuf)) return true;
  }
  return false;
}
