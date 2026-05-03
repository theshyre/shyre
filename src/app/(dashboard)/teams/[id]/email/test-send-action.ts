"use server";

import { runSafeAction } from "@/lib/safe-action";
import { AppError } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { decryptForTeam } from "@/lib/messaging/encryption";
import { senderFor } from "@/lib/messaging/providers";
import {
  sanitizeHeaderValue,
  validateRecipient,
} from "@/lib/messaging/render";
import { randomUUID } from "node:crypto";

/**
 * Send a sample message to the *currently logged-in user's* mailbox
 * for end-to-end verification. The user pastes their API key,
 * verifies their domain, then clicks "Send test to me" to confirm
 * the delivery path works before they aim it at a real customer.
 *
 * Bypasses the daily cap (test sends shouldn't burn the customer
 * quota) but still goes through the same renderer + validator
 * pipeline so a malformed config errors here, not on the next real
 * invoice send.
 */
export async function sendTestEmailAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    if (!teamId) throw new Error("team_id is required.");
    const { role, userId } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw AppError.refusal(
        "Only team owners and admins can send a test email.",
      );
    }

    // Look up the recipient (logged-in user's email). Must come
    // from auth.users — user_profiles doesn't store email. We use
    // the admin client because authenticated reads can't see
    // auth.users directly.
    const { data: cfg } = await supabase
      .from("team_email_config")
      .select(
        "api_key_encrypted, from_email, from_name, reply_to_email, signature",
      )
      .eq("team_id", teamId)
      .maybeSingle();
    if (!cfg?.api_key_encrypted) {
      throw new Error(
        "Save an API key first — settings need to be saved before testing.",
      );
    }
    if (!cfg.from_email) {
      throw new Error(
        "Set a From address first — the test send needs to know who it's from.",
      );
    }

    const apiKey = await decryptForTeam(
      supabase,
      teamId,
      cfg.api_key_encrypted as Buffer | string,
    );
    if (!apiKey) throw new Error("Could not decrypt the saved API key.");

    // From-domain allow-list — defense in depth.
    const at = (cfg.from_email as string).lastIndexOf("@");
    if (at < 0) throw new Error("From address has no domain.");
    const fromDomain = (cfg.from_email as string).slice(at + 1).toLowerCase();
    const { data: domain } = await supabase
      .from("verified_email_domains")
      .select("status")
      .eq("team_id", teamId)
      .ilike("domain", fromDomain)
      .maybeSingle();
    if (!domain || domain.status !== "verified") {
      throw new Error(
        `Domain ${fromDomain} is not verified yet. Add the DNS records and click Verify before sending.`,
      );
    }

    // Resolve the user's email from auth.admin (server-only).
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data: userRes, error: userErr } =
      await admin.auth.admin.getUserById(userId);
    if (userErr || !userRes?.user?.email) {
      throw new Error("Could not resolve your email to send the test.");
    }
    const myEmail = userRes.user.email;
    if (validateRecipient(myEmail) !== null) {
      throw new Error(`Your email (${myEmail}) is not deliverable.`);
    }

    const subject = sanitizeHeaderValue(
      `Shyre test — ${cfg.from_email as string}`,
    );
    const fromName = cfg.from_name
      ? sanitizeHeaderValue(cfg.from_name as string)
      : null;
    const html = `
      <p>This is a test email from Shyre.</p>
      <p>If you can read this, your email config is working.</p>
      <p>From: <code>${cfg.from_email as string}</code></p>
      <p>Reply-To: <code>${(cfg.reply_to_email as string | null) ?? "(unset)"}</code></p>
    `.trim();
    const text = [
      "This is a test email from Shyre.",
      "If you can read this, your email config is working.",
      "",
      `From: ${cfg.from_email as string}`,
      `Reply-To: ${(cfg.reply_to_email as string | null) ?? "(unset)"}`,
    ].join("\n");

    const sender = senderFor("resend", apiKey);
    await sender.send({
      from: { email: cfg.from_email as string, name: fromName ?? undefined },
      to: [{ email: myEmail }],
      replyTo: (cfg.reply_to_email as string | null) ?? undefined,
      subject,
      html,
      text,
      idempotencyKey: `test:${teamId}:${randomUUID()}`,
      tags: { shyre_team_id: teamId, shyre_kind: "test" },
    });

    // Don't write to the outbox for tests; bookkeeper-grade audit
    // is reserved for real sends to customers.
  }, "sendTestEmailAction") as unknown as void;
}
