import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, SendResult } from "./sender";
import type { MessageSender } from "./sender";

/**
 * Outbox: enqueue + drain + retry.
 *
 * Why a queue at all (vs send-and-forget): the action layer needs a
 * stable record before handing off to the provider. Enqueueing
 * first means a 500-from-Resend doesn't lose the user's intent —
 * we keep the row, retry, and surface status. Enqueue is also the
 * audit-trail anchor (subject + body + pdf sha256 + ids).
 *
 * Phase 1 drains synchronously inside the action ("queued → sent
 * within the request"). Phase 2 introduces a cron-driven drain
 * for retries and reminders without changing this shape.
 */

export type OutboxStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed_retryable"
  | "failed_permanent";

export interface OutboxRow {
  id: string;
  team_id: string;
  user_id: string | null;
  related_kind: "invoice" | "invoice_reminder" | "payment_thanks";
  related_id: string | null;
  provider: "resend";
  provider_message_id: string | null;
  from_email: string;
  from_name: string | null;
  reply_to_email: string | null;
  /** Joined string ("a@x.com, b@x.com") — kept for legacy readers
   *  while the column is phased out. New code reads `to_emails`. */
  to_email: string;
  /** Structured recipient list. The bookkeeper-grade audit-trail
   *  source after the 2026-05-04 migration. Always populated by the
   *  send path; backfilled on existing rows from the joined string. */
  to_emails: string[];
  cc_emails: string[] | null;
  bcc_emails: string[] | null;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  attachments: unknown;
  attachment_pdf_sha256: string | null;
  idempotency_key: string;
  status: OutboxStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  error_message: string | null;
  bounce_reason: string | null;
  bounce_type: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueInput {
  teamId: string;
  userId: string | null;
  relatedKind: OutboxRow["related_kind"];
  relatedId: string | null;
  fromEmail: string;
  fromName: string | null;
  replyToEmail: string | null;
  /** Structured To: list — one element per recipient. Caller must
   *  pass the array even for single-recipient sends. The joined
   *  string lands in `to_email` for legacy readers automatically. */
  toEmails: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
  attachmentPdfSha256?: string | null;
  idempotencyKey: string;
}

/**
 * Insert an outbox row. Always uses the admin client because RLS
 * has no INSERT policy for `authenticated` — writes flow through
 * the messaging module, the action layer never touches the table
 * directly.
 *
 * Idempotency: the unique constraint on `idempotency_key` makes a
 * duplicate call surface as a Postgres 23505. We catch and return
 * the existing row instead of creating a duplicate.
 */
export async function enqueue(input: EnqueueInput): Promise<OutboxRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("message_outbox")
    .insert({
      team_id: input.teamId,
      user_id: input.userId,
      related_kind: input.relatedKind,
      related_id: input.relatedId,
      from_email: input.fromEmail,
      from_name: input.fromName,
      reply_to_email: input.replyToEmail,
      // Write both shapes: structured array (the canonical column
      // bookkeeper queries hit going forward) AND the legacy
      // joined string (the column the existing readers still use,
      // queued for removal once every surface migrates).
      to_emails: input.toEmails,
      to_email: input.toEmails.join(", "),
      cc_emails: input.ccEmails ?? null,
      bcc_emails: input.bccEmails ?? null,
      subject: input.subject,
      body_html: input.bodyHtml,
      body_text: input.bodyText,
      // Store attachment metadata only — never the bytes. The
      // outbox row stays small + queryable; the bytes are in the
      // PDF blob the renderer reproduces from the invoice.
      attachments:
        input.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.content.length,
        })) ?? null,
      attachment_pdf_sha256: input.attachmentPdfSha256 ?? null,
      idempotency_key: input.idempotencyKey,
      status: "queued" as OutboxStatus,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Existing row — return it for the caller to re-drive.
      const existing = await supabase
        .from("message_outbox")
        .select("*")
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      if (existing.error || !existing.data) {
        throw new Error(
          `Idempotent enqueue collided but lookup failed: ${error.message}`,
        );
      }
      return existing.data as OutboxRow;
    }
    throw new Error(`Failed to enqueue message: ${error.message}`);
  }
  if (!data) throw new Error("Enqueue returned no row.");
  return data as OutboxRow;
}

/**
 * Send a queued row through the provider and record the result.
 *
 * Status transitions:
 *   queued → sending → sent       (provider accepted; webhook later
 *                                  flips to delivered / bounced)
 *   queued → sending → failed_retryable  (5xx / 429 / network)
 *   queued → sending → failed_permanent  (4xx that won't fix itself:
 *                                          400 / 401 / 403 / 422)
 *
 * Resend's idempotency-key header dedupes within their backend if
 * the request retries; our own idempotency_key dedupes at enqueue.
 */
export async function drain(
  row: OutboxRow,
  message: OutboundMessage,
  sender: MessageSender,
): Promise<{ row: OutboxRow; result?: SendResult }> {
  const supabase = createAdminClient();

  await supabase
    .from("message_outbox")
    .update({
      status: "sending" as OutboxStatus,
      attempt_count: row.attempt_count + 1,
    })
    .eq("id", row.id);

  let result: SendResult;
  try {
    result = await sender.send(message);
  } catch (err) {
    const status = classifyError(err);
    await supabase
      .from("message_outbox")
      .update({
        status,
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq("id", row.id);
    logError(err, {
      teamId: row.team_id,
      userId: row.user_id ?? undefined,
      action: "messaging.drain",
    });
    throw err;
  }

  const { data: updated } = await supabase
    .from("message_outbox")
    .update({
      status: "sent" as OutboxStatus,
      provider_message_id: result.providerMessageId,
      sent_at: result.acceptedAt.toISOString(),
      last_event_at: result.acceptedAt.toISOString(),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  return { row: (updated as OutboxRow) ?? row, result };
}

/**
 * Append a webhook event row + flip the parent's status when the
 * event is terminal (delivered / bounced / complained). The webhook
 * route owns this — never call from anywhere else.
 */
export async function recordEvent(
  outboxId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("message_outbox_events").insert({
    outbox_id: outboxId,
    event_type: eventType,
    payload,
  });

  const next = mapEventToStatus(eventType);
  if (!next) return;

  const updates: Record<string, unknown> = {
    status: next.status,
    last_event_at: new Date().toISOString(),
  };
  if (next.status === "delivered") {
    updates.delivered_at = new Date().toISOString();
  }
  if (next.status === "bounced") {
    updates.bounce_type = next.bounceType ?? null;
    updates.bounce_reason = next.bounceReason ?? null;
  }
  await supabase
    .from("message_outbox")
    .update(updates)
    .eq("id", outboxId);
}

/** Map provider event types to our internal status enum. Returns
 *  null for events we don't currently track (open/click — Phase 2). */
function mapEventToStatus(
  eventType: string,
): { status: OutboxStatus; bounceType?: string; bounceReason?: string } | null {
  // Resend events: email.sent, email.delivered, email.delivery_delayed,
  // email.bounced, email.complained, email.opened, email.clicked.
  switch (eventType) {
    case "email.delivered":
      return { status: "delivered" };
    case "email.bounced":
      return { status: "bounced", bounceType: "hard" };
    case "email.complained":
      return { status: "complained" };
    default:
      return null;
  }
}

function classifyError(err: unknown): OutboxStatus {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = Number((err as { status: number }).status);
    if (status === 429) return "failed_retryable";
    if (status >= 500) return "failed_retryable";
    if (status >= 400) return "failed_permanent";
  }
  return "failed_retryable";
}

/** Look up the team's encrypted API key + provider config. Returns
 *  null when the team hasn't configured email yet. Designed for the
 *  send action's "is this team set up?" precheck. */
export async function loadTeamConfig(
  supabase: SupabaseClient,
  teamId: string,
): Promise<{
  apiKeyCipher: Buffer | string | null;
  fromEmail: string | null;
  fromName: string | null;
  replyToEmail: string | null;
  signature: string | null;
} | null> {
  const { data } = await supabase
    .from("team_email_config")
    .select(
      "api_key_encrypted, from_email, from_name, reply_to_email, signature",
    )
    .eq("team_id", teamId)
    .maybeSingle();
  if (!data) return null;
  return {
    apiKeyCipher:
      (data.api_key_encrypted as Buffer | string | null) ?? null,
    fromEmail: (data.from_email as string | null) ?? null,
    fromName: (data.from_name as string | null) ?? null,
    replyToEmail: (data.reply_to_email as string | null) ?? null,
    signature: (data.signature as string | null) ?? null,
  };
}

/** Confirm the from address belongs to a verified domain owned by
 *  the team. Defense in depth — Resend's own check is one layer,
 *  this is ours. SAL-016. */
export async function assertFromDomainAllowed(
  supabase: SupabaseClient,
  teamId: string,
  fromEmail: string,
): Promise<void> {
  const at = fromEmail.lastIndexOf("@");
  if (at < 0) throw new Error("From address has no domain.");
  const domain = fromEmail.slice(at + 1).toLowerCase();
  const { data } = await supabase
    .from("verified_email_domains")
    .select("id, status")
    .eq("team_id", teamId)
    .ilike("domain", domain)
    .maybeSingle();
  if (!data || data.status !== "verified") {
    throw new Error(
      `Domain ${domain} is not verified for sending. Visit /settings/email to add DNS records.`,
    );
  }
}
