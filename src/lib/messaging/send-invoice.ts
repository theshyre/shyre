import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { decryptForTeam } from "./encryption";
import {
  assertFromDomainAllowed,
  drain,
  enqueue,
  loadTeamConfig,
} from "./outbox";
import { senderFor } from "./providers";
import {
  sanitizeHeaderValue,
  validateRecipient,
  type VariableBag,
} from "./render";
import type { OutboundMessage } from "./sender";
import { consumeDailyQuota } from "./rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * High-level "send this invoice" entry point. Action layers call
 * this; it stitches together the cascade:
 *
 *   1. Load team_email_config (decrypt API key)
 *   2. Validate recipient + sanitize subject + assert from-domain
 *   3. Daily-cap consume
 *   4. Enqueue outbox row (with PDF sha256)
 *   5. Drain through provider
 *   6. Return the row + result for the action to surface
 *
 * On any failure, the outbox row's status reflects what happened
 * (queued / failed_permanent / failed_retryable) so the user sees
 * an honest status in the activity log even when the send didn't
 * leave the building.
 */

export interface SendInvoiceInput {
  teamId: string;
  userId: string;
  invoiceId: string;
  /** Pre-rendered subject + body. The action layer composes them
   *  from the team's template + the variable bag; we just need the
   *  final strings here. */
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** Recipient(s). `to` is required; cc/bcc optional. */
  toEmail: string;
  ccEmails?: string[];
  bccEmails?: string[];
  /** Override the team's configured From / Reply-To when the user
   *  changed them in the compose modal. Falls through to team
   *  defaults when null. */
  fromEmailOverride?: string | null;
  fromNameOverride?: string | null;
  replyToEmailOverride?: string | null;
  /** PDF attachment bytes — produced by the action via the same
   *  React-PDF render the Download PDF button uses. */
  pdfBytes: Buffer;
  pdfFilename: string;
  /** Whether this is a regular send, a reminder, or a thank-you.
   *  Phase 1 uses `invoice` only; Phase 2/3 wire the others. */
  kind: "invoice" | "invoice_reminder" | "payment_thanks";
}

export async function sendInvoice(
  supabase: SupabaseClient,
  input: SendInvoiceInput,
): Promise<{ outboxId: string; providerMessageId: string }> {
  // 1. Config
  const cfg = await loadTeamConfig(supabase, input.teamId);
  if (!cfg) {
    throw new Error(
      "Email is not configured for this team. Visit /settings/email.",
    );
  }
  if (!cfg.apiKeyCipher) {
    throw new Error("Email API key is missing. Visit /settings/email.");
  }
  const apiKey = await decryptForTeam(supabase, input.teamId, cfg.apiKeyCipher);
  if (!apiKey) {
    throw new Error("Email API key could not be decrypted.");
  }

  const fromEmail =
    input.fromEmailOverride?.trim() || cfg.fromEmail || "";
  if (!fromEmail) {
    throw new Error("From address is not set. Visit /settings/email.");
  }
  const fromName = input.fromNameOverride?.trim() || cfg.fromName || null;
  const replyToEmail =
    input.replyToEmailOverride?.trim() || cfg.replyToEmail || null;

  // 2. Validate recipients + sanitize headers
  const recipientCheck = validateRecipient(input.toEmail);
  if (recipientCheck === "invalid") {
    throw new Error(`Recipient ${input.toEmail} is not a valid email.`);
  }
  if (recipientCheck === "role") {
    throw new Error(
      `Cannot send to role address ${input.toEmail} — use a person's mailbox instead.`,
    );
  }
  for (const cc of input.ccEmails ?? []) {
    if (validateRecipient(cc) !== null) {
      throw new Error(`CC ${cc} is not a valid recipient.`);
    }
  }

  const subject = sanitizeHeaderValue(input.subject);
  if (!subject) {
    throw new Error("Subject is empty.");
  }
  const sanitizedFromName = fromName ? sanitizeHeaderValue(fromName) : null;
  const sanitizedReplyTo = replyToEmail
    ? sanitizeHeaderValue(replyToEmail)
    : null;

  // 3. From-domain allow-list (defense in depth — Resend also
  //    enforces, but we don't trust the provider alone).
  await assertFromDomainAllowed(supabase, input.teamId, fromEmail);

  // 4. Daily cap
  const quota = await consumeDailyQuota(supabase, input.teamId);
  if (!quota.allowed) {
    if (quota.reason === "no_config") {
      throw new Error("Email is not configured for this team.");
    }
    throw new Error(
      `Daily send cap reached (${quota.cap}/day). Try again tomorrow or raise the cap in settings.`,
    );
  }

  // 5. Enqueue
  const pdfSha256 = createHash("sha256").update(input.pdfBytes).digest("hex");
  // Idempotency key: kind + invoice + day-bucket + nonce. The day
  // bucket lets a same-day re-send still register as a distinct row;
  // Resend's own header-level dedupe handles transport-layer
  // retries within a single attempt.
  const dayBucket = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `${input.kind}:${input.invoiceId}:${dayBucket}:${randomUUID()}`;

  const row = await enqueue({
    teamId: input.teamId,
    userId: input.userId,
    relatedKind: input.kind,
    relatedId: input.invoiceId,
    fromEmail,
    fromName: sanitizedFromName,
    replyToEmail: sanitizedReplyTo,
    toEmail: input.toEmail,
    ccEmails: input.ccEmails,
    bccEmails: input.bccEmails,
    subject,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    attachments: [
      {
        filename: input.pdfFilename,
        content: input.pdfBytes,
        contentType: "application/pdf",
      },
    ],
    attachmentPdfSha256: pdfSha256,
    idempotencyKey,
  });

  // 6. Drain
  const sender = senderFor("resend", apiKey);
  const message: OutboundMessage = {
    from: { email: fromEmail, name: sanitizedFromName ?? undefined },
    to: [{ email: input.toEmail }],
    cc: input.ccEmails?.map((e) => ({ email: e })),
    bcc: input.bccEmails?.map((e) => ({ email: e })),
    replyTo: sanitizedReplyTo ?? undefined,
    subject,
    html: input.bodyHtml,
    text: input.bodyText,
    attachments: [
      {
        filename: input.pdfFilename,
        content: input.pdfBytes,
        contentType: "application/pdf",
      },
    ],
    idempotencyKey,
    tags: {
      shyre_team_id: input.teamId,
      shyre_invoice_id: input.invoiceId,
      shyre_kind: input.kind,
    },
  };

  const { row: sentRow, result } = await drain(row, message, sender);

  if (!result) {
    throw new Error(`Send failed for outbox ${row.id}.`);
  }

  return {
    outboxId: sentRow.id,
    providerMessageId: result.providerMessageId,
  };
}

export type { VariableBag };
