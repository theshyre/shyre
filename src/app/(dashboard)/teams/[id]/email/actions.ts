"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk, AppError } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import {
  decryptForTeam,
  encryptForTeam,
} from "@/lib/messaging/encryption";
import { senderFor } from "@/lib/messaging/providers";
import { sanitizeHeaderValue, validateRecipient } from "@/lib/messaging/render";

/**
 * Owner / admin only — RLS enforces too, but we add an early role
 * check so a non-admin caller gets a clear error message instead
 * of a silent no-op from RLS rejecting the upsert.
 */
async function ensureOwnerAdmin(teamId: string): Promise<{ userId: string }> {
  const { role, userId } = await validateTeamAccess(teamId);
  if (role !== "owner" && role !== "admin") {
    throw AppError.refusal(
      "Only team owners and admins can configure email.",
    );
  }
  return { userId };
}

/**
 * Save the team's email config: API key (encrypted on write), From,
 * Reply-To, signature, daily cap. Empty `api_key` means "leave the
 * existing key alone" — we don't want a save with the field blank
 * to wipe the configured key.
 */
export async function updateEmailConfigAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    if (!teamId) throw new Error("team_id is required.");
    await ensureOwnerAdmin(teamId);

    const fromEmail =
      ((formData.get("from_email") as string) ?? "").trim() || null;
    const fromName =
      sanitizeHeaderValue((formData.get("from_name") as string) ?? "") ||
      null;
    const replyToEmail =
      ((formData.get("reply_to_email") as string) ?? "").trim() || null;
    const signature = ((formData.get("signature") as string) ?? "") || null;
    const dailyCapRaw = (formData.get("daily_cap") as string) ?? "";
    const dailyCap = dailyCapRaw
      ? Math.max(0, Math.min(1000, parseInt(dailyCapRaw, 10) || 0))
      : 50;

    if (fromEmail && validateRecipient(fromEmail) !== null) {
      throw new Error(`From address ${fromEmail} is not a valid email.`);
    }
    if (replyToEmail && validateRecipient(replyToEmail) !== null) {
      throw new Error(
        `Reply-To address ${replyToEmail} is not a valid email.`,
      );
    }

    const patch: Record<string, unknown> = {
      team_id: teamId,
      from_email: fromEmail,
      from_name: fromName,
      reply_to_email: replyToEmail,
      signature,
      daily_cap: dailyCap,
    };

    // API key: only update when a new value is supplied. Empty
    // string means "no change." This lets the form stay safely
    // blank when the user is editing other fields.
    //
    // Envelope encryption: encryptForTeam generates the team's DEK
    // on first save (if missing) and uses it to encrypt the API
    // key. Subsequent saves reuse the existing DEK. SAL-018.
    const apiKeyRaw = (formData.get("api_key") as string)?.trim();
    if (apiKeyRaw) {
      const cipher = await encryptForTeam(supabase, teamId, apiKeyRaw);
      patch.api_key_encrypted = cipher;
    }

    assertSupabaseOk(
      await supabase.from("team_email_config").upsert(patch),
    );

    revalidatePath(`/teams/${teamId}/email`);
  }, "updateEmailConfigAction") as unknown as void;
}

/**
 * Add or refresh a domain for verification. Calls Resend's API to
 * create the domain (idempotent — returns existing if it's already
 * registered) and stores the returned DNS records. The user adds
 * those records to their DNS, then clicks "Re-check" which calls
 * `verifyEmailDomainAction` below.
 */
export async function addEmailDomainAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    if (!teamId) throw new Error("team_id is required.");
    await ensureOwnerAdmin(teamId);

    const domain = ((formData.get("domain") as string) ?? "").trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      throw new Error(`"${domain}" is not a valid domain.`);
    }

    const { data: cfg } = await supabase
      .from("team_email_config")
      .select("api_key_encrypted")
      .eq("team_id", teamId)
      .maybeSingle();
    if (!cfg?.api_key_encrypted) {
      throw new Error(
        "Save an API key first — Resend domain verification needs it.",
      );
    }
    const apiKey = await decryptForTeam(
      supabase,
      teamId,
      cfg.api_key_encrypted as Buffer | string,
    );
    if (!apiKey) throw new Error("Could not decrypt the saved API key.");

    const sender = senderFor("resend", apiKey);
    const status = await sender.ensureDomain(domain);

    assertSupabaseOk(
      await supabase.from("verified_email_domains").upsert(
        {
          team_id: teamId,
          domain,
          provider_domain_id: status.providerDomainId,
          status: status.status,
          dns_records: status.dnsRecords,
          verified_at:
            status.status === "verified" ? new Date().toISOString() : null,
          last_checked_at: new Date().toISOString(),
          failure_reason: status.failureReason ?? null,
        },
        { onConflict: "team_id,domain" },
      ),
    );

    revalidatePath(`/teams/${teamId}/email`);
  }, "addEmailDomainAction") as unknown as void;
}

/** Re-check a previously-added domain's DNS state. */
export async function verifyEmailDomainAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const domainId = formData.get("domain_id") as string;
    if (!teamId || !domainId) {
      throw new Error("team_id and domain_id are required.");
    }
    await ensureOwnerAdmin(teamId);

    const { data: row } = await supabase
      .from("verified_email_domains")
      .select("provider_domain_id")
      .eq("id", domainId)
      .eq("team_id", teamId)
      .maybeSingle();
    if (!row?.provider_domain_id) {
      throw new Error("Domain row not found.");
    }

    const { data: cfg } = await supabase
      .from("team_email_config")
      .select("api_key_encrypted")
      .eq("team_id", teamId)
      .maybeSingle();
    if (!cfg?.api_key_encrypted) {
      throw new Error("API key missing.");
    }
    const apiKey = await decryptForTeam(
      supabase,
      teamId,
      cfg.api_key_encrypted as Buffer | string,
    );
    if (!apiKey) throw new Error("Could not decrypt the saved API key.");

    const sender = senderFor("resend", apiKey);
    const status = await sender.refreshDomain(row.provider_domain_id as string);

    assertSupabaseOk(
      await supabase
        .from("verified_email_domains")
        .update({
          status: status.status,
          dns_records: status.dnsRecords,
          verified_at:
            status.status === "verified" ? new Date().toISOString() : null,
          last_checked_at: new Date().toISOString(),
          failure_reason: status.failureReason ?? null,
        })
        .eq("id", domainId),
    );

    revalidatePath(`/teams/${teamId}/email`);
  }, "verifyEmailDomainAction") as unknown as void;
}

/**
 * Persist a per-team default subject + body template for one of
 * the message kinds (invoice_send / invoice_reminder /
 * payment_thanks). Phase 1 only uses invoice_send.
 */
export async function updateMessageTemplateAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const kind = formData.get("kind") as string;
    const subject = ((formData.get("subject") as string) ?? "").trim();
    const body = ((formData.get("body") as string) ?? "").trim();

    if (!teamId) throw new Error("team_id is required.");
    if (
      kind !== "invoice_send" &&
      kind !== "invoice_reminder" &&
      kind !== "payment_thanks"
    ) {
      throw new Error(`Invalid template kind: ${kind}`);
    }
    if (!subject) throw new Error("Subject is required.");
    if (!body) throw new Error("Body is required.");

    await ensureOwnerAdmin(teamId);

    assertSupabaseOk(
      await supabase
        .from("message_templates")
        .upsert(
          { team_id: teamId, kind, subject, body },
          { onConflict: "team_id,kind" },
        ),
    );

    revalidatePath(`/teams/${teamId}/email`);
  }, "updateMessageTemplateAction") as unknown as void;
}
