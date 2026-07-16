import "server-only";

import { randomUUID } from "node:crypto";
import { decryptForTeam } from "./encryption";
import {
  assertFromDomainAllowed,
  drain,
  enqueue,
  loadTeamConfig,
} from "./outbox";
import { senderFor } from "./providers";
import { sanitizeHeaderValue, validateRecipient } from "./render";
import type { OutboundMessage } from "./sender";
import { consumeDailyQuota } from "./rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SendProposalEmailInput {
  teamId: string;
  userId: string | null;
  proposalId: string;
  /** `proposal` = the sign-link email; `proposal_otp` = the one-time code. */
  kind: "proposal" | "proposal_otp";
  toEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/**
 * Send a proposal email (sign link or OTP) through the same hardened
 * pipeline as invoices: team config + decrypted key → header sanitation →
 * recipient validation → from-domain allow-list → daily-cap consume →
 * outbox enqueue → provider drain. No attachments — the sign page is the
 * document, and the OTP is body-only by design (a forwarded attachment
 * shouldn't carry a live code).
 */
export async function sendProposalEmail(
  supabase: SupabaseClient,
  input: SendProposalEmailInput,
): Promise<{ outboxId: string; providerMessageId: string }> {
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

  const fromEmail = sanitizeHeaderValue(cfg.fromEmail ?? "");
  if (!fromEmail) {
    throw new Error("From address is not set. Visit /settings/email.");
  }
  const fromName = cfg.fromName ? sanitizeHeaderValue(cfg.fromName) : null;
  const replyToEmail = cfg.replyToEmail
    ? sanitizeHeaderValue(cfg.replyToEmail)
    : null;

  const recipientCheck = validateRecipient(input.toEmail);
  if (recipientCheck === "invalid") {
    throw new Error(`Recipient ${input.toEmail} is not a valid email.`);
  }
  if (recipientCheck === "role") {
    throw new Error(
      `Cannot send to role address ${input.toEmail} — use a person's mailbox instead.`,
    );
  }

  const subject = sanitizeHeaderValue(input.subject);
  if (!subject) {
    throw new Error("Subject is empty.");
  }

  await assertFromDomainAllowed(supabase, input.teamId, fromEmail);

  const quota = await consumeDailyQuota(supabase, input.teamId, 1);
  if (!quota.allowed) {
    if (quota.reason === "no_config") {
      throw new Error("Email is not configured for this team.");
    }
    throw new Error(
      `Daily send cap reached (${quota.cap}/day). Try again tomorrow or raise the cap in settings.`,
    );
  }

  const dayBucket = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `${input.kind}:${input.proposalId}:${dayBucket}:${randomUUID()}`;

  const row = await enqueue({
    teamId: input.teamId,
    userId: input.userId,
    relatedKind: input.kind,
    relatedId: input.proposalId,
    fromEmail,
    fromName,
    replyToEmail,
    toEmails: [input.toEmail],
    subject,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    idempotencyKey,
  });

  const sender = senderFor("resend", apiKey);
  const message: OutboundMessage = {
    from: { email: fromEmail, name: fromName ?? undefined },
    to: [{ email: input.toEmail }],
    replyTo: replyToEmail ?? undefined,
    subject,
    html: input.bodyHtml,
    text: input.bodyText,
    idempotencyKey,
    tags: {
      shyre_team_id: input.teamId,
      shyre_proposal_id: input.proposalId,
      shyre_kind: input.kind,
    },
  };

  const { row: sentRow, result } = await drain(row, message, sender);
  if (!result) {
    throw new Error(`Send failed for outbox ${row.id}.`);
  }
  return { outboxId: sentRow.id, providerMessageId: result.providerMessageId };
}
