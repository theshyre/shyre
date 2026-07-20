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

export interface SendTeamInviteEmailInput {
  teamId: string;
  userId: string;
  inviteId: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/**
 * Send a team-invite email through the same hardened pipeline as
 * invoices and proposals (SAL audit batch C): team config + decrypted
 * key → header sanitation → recipient validation → from-domain
 * allow-list → daily-cap consume → outbox enqueue → provider drain.
 *
 * Callers must treat every failure here as non-fatal to invite
 * creation — the invite row is the source of truth, and the "Copy
 * invite link" affordance in the members UI is the durable fallback
 * whether or not this send succeeds. See `inviteMemberAction` in
 * `src/app/(dashboard)/teams/[id]/team-actions.ts`, which wraps this
 * call in a try/catch and logs rather than throws.
 */
export async function sendTeamInviteEmail(
  supabase: SupabaseClient,
  input: SendTeamInviteEmailInput,
): Promise<{ outboxId: string; providerMessageId: string }> {
  const cfg = await loadTeamConfig(supabase, input.teamId);
  if (!cfg) {
    throw new Error("Email is not configured for this team.");
  }
  if (!cfg.apiKeyCipher) {
    throw new Error("Email API key is missing.");
  }
  const apiKey = await decryptForTeam(supabase, input.teamId, cfg.apiKeyCipher);
  if (!apiKey) {
    throw new Error("Email API key could not be decrypted.");
  }

  const fromEmail = sanitizeHeaderValue(cfg.fromEmail ?? "");
  if (!fromEmail) {
    throw new Error("From address is not set.");
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
  const idempotencyKey = `team_invite:${input.inviteId}:${dayBucket}:${randomUUID()}`;

  const row = await enqueue({
    teamId: input.teamId,
    userId: input.userId,
    relatedKind: "team_invite",
    relatedId: input.inviteId,
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
      shyre_invite_id: input.inviteId,
      shyre_kind: "team_invite",
    },
  };

  const { row: sentRow, result } = await drain(row, message, sender);
  if (!result) {
    throw new Error(`Send failed for outbox ${row.id}.`);
  }
  return { outboxId: sentRow.id, providerMessageId: result.providerMessageId };
}
