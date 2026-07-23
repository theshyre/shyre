"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runSafeAction, type ActionResult } from "@/lib/safe-action";
import { requireTeamAdmin } from "@/lib/team-context";
import { AppError, assertSupabaseOk } from "@/lib/errors";
import { unwrapEmbed } from "@/lib/supabase/embed";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/messaging/escape-html";
import { sendSignoffEmail } from "@/lib/messaging/send-signoff";
import { generateSignToken, TOKEN_TTL_DAYS } from "@/lib/sign/tokens";
import {
  isSignoffDeletable,
  isSignoffEditable,
  signoffSendReadiness,
} from "@/lib/sign/readiness";
import {
  signoffDraftSchema,
  type SignoffDraftInput,
} from "@/lib/schemas/signoff";

/**
 * Parse the authoring form's single JSON `payload` field (nested signer rows
 * don't map onto flat FormData) and validate at the boundary. Draft-lenient:
 * completeness is a SEND concern, not a save concern.
 */
function parsePayload(formData: FormData): SignoffDraftInput {
  const raw = formData.get("payload");
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Missing sign-off payload.");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Malformed sign-off payload.");
  }
  const parsed = signoffDraftSchema.safeParse(json);
  if (!parsed.success) {
    throw AppError.fromZodError({
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.filter(
          (p): p is string | number => typeof p !== "symbol",
        ),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

/** Insert the signer roster for a document (draft only — the send-lock trigger
 *  freezes it after send). Dedupes by lowercased email at the app layer; the
 *  DB carries a UNIQUE(document_id, email) backstop. */
async function replaceSigners(
  supabase: SupabaseClient,
  documentId: string,
  teamId: string,
  signers: SignoffDraftInput["signers"],
): Promise<void> {
  assertSupabaseOk(
    await supabase.from("signoff_signers").delete().eq("document_id", documentId),
  );
  if (signers.length === 0) return;
  const seen = new Set<string>();
  const rows = signers
    .filter((s) => {
      const key = s.email.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s, i) => ({
      document_id: documentId,
      team_id: teamId,
      name: s.name.trim(),
      email: s.email.trim().toLowerCase(),
      role_label: s.roleLabel?.trim() || null,
      org_label: s.orgLabel?.trim() || null,
      sort_order: i,
    }));
  assertSupabaseOk(await supabase.from("signoff_signers").insert(rows));
}

async function loadCustomerInTeam(
  supabase: SupabaseClient,
  customerId: string | null | undefined,
  teamId: string,
): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!data) {
    throw AppError.refusal("That customer isn't on the selected team.");
  }
  return customerId;
}

export async function createSignoffAction(
  formData: FormData,
): Promise<ActionResult> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const input = parsePayload(fd);
      await requireTeamAdmin(input.team_id);
      const customerId = await loadCustomerInTeam(
        supabase,
        input.customer_id,
        input.team_id,
      );

      const { data: created, error } = await supabase
        .from("signoff_documents")
        .insert({
          team_id: input.team_id,
          customer_id: customerId,
          document_type: input.document_type,
          title: input.title.trim(),
          version_label: input.version_label?.trim() || null,
          body_markdown: input.body_markdown,
          external_ref: input.external_ref?.trim() || null,
          signing_mode: input.signing_mode,
          sign_theme: input.sign_theme,
        })
        .select("id")
        .single();
      assertSupabaseOk({ data: created, error });
      const documentId = (created as { id: string }).id;

      await replaceSigners(supabase, documentId, input.team_id, input.signers);
      revalidatePath("/signoffs");
      redirect(`/signoffs/${documentId}`);
    },
    { actionName: "createSignoff", teamIdFrom: teamIdFromPayload },
  );
}

export async function updateSignoffDraftAction(
  formData: FormData,
): Promise<ActionResult> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const documentId = fd.get("document_id");
      if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Missing document id.");
      }
      const input = parsePayload(fd);
      await requireTeamAdmin(input.team_id);

      const { data: existing } = await supabase
        .from("signoff_documents")
        .select("id, status, team_id")
        .eq("id", documentId)
        .maybeSingle();
      if (!existing) throw AppError.notFound("Sign-off");
      if (!isSignoffEditable((existing as { status: string }).status)) {
        throw AppError.refusal(
          "This sign-off was sent — its content is frozen. Create a new one to make changes.",
        );
      }
      const customerId = await loadCustomerInTeam(
        supabase,
        input.customer_id,
        input.team_id,
      );

      assertSupabaseOk(
        await supabase
          .from("signoff_documents")
          .update({
            customer_id: customerId,
            title: input.title.trim(),
            version_label: input.version_label?.trim() || null,
            body_markdown: input.body_markdown,
            external_ref: input.external_ref?.trim() || null,
            signing_mode: input.signing_mode,
            sign_theme: input.sign_theme,
          })
          .eq("id", documentId),
      );
      await replaceSigners(supabase, documentId, input.team_id, input.signers);
      revalidatePath("/signoffs");
      revalidatePath(`/signoffs/${documentId}`);
    },
    { actionName: "updateSignoffDraft" },
  );
}

export async function deleteSignoffAction(
  formData: FormData,
): Promise<ActionResult> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const documentId = fd.get("document_id");
      if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Missing document id.");
      }
      const { data: doc } = await supabase
        .from("signoff_documents")
        .select("id, status, team_id")
        .eq("id", documentId)
        .maybeSingle();
      if (!doc) throw AppError.notFound("Sign-off");
      const row = unwrapEmbed(doc) as { status: string; team_id: string };
      await requireTeamAdmin(row.team_id);
      if (!isSignoffDeletable(row.status)) {
        throw AppError.refusal(
          "A sent sign-off is part of the audit record and can't be deleted.",
        );
      }
      // Draft/canceled → hard delete (the send-lock guard permits it; CASCADE
      // clears signers/tokens/events).
      assertSupabaseOk(
        await supabase.from("signoff_documents").delete().eq("id", documentId),
      );
      revalidatePath("/signoffs");
    },
    { actionName: "deleteSignoff" },
  );
}

/**
 * Send a draft sign-off: mint a per-signer token, email each signatory the
 * private sign link, flip draft → sent. Refuses an incomplete draft. The
 * signer roster is send-locked by the DB trigger once this lands, so a later
 * roster edit is blocked (a change is a new sign-off).
 */
export async function sendSignoffAction(
  formData: FormData,
): Promise<ActionResult> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const documentId = fd.get("document_id");
      if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Missing document id.");
      }
      const { data: doc } = await supabase
        .from("signoff_documents")
        .select("id, team_id, title, version_label, status, body_markdown, signoff_signers(id, name, email)")
        .eq("id", documentId)
        .maybeSingle();
      if (!doc) throw AppError.notFound("Sign-off");
      const teamId = doc.team_id as string;
      await requireTeamAdmin(teamId);
      if ((doc.status as string) !== "draft") {
        throw AppError.refusal("This sign-off has already been sent.");
      }
      const signers = (Array.isArray(doc.signoff_signers) ? doc.signoff_signers : []) as Array<{
        id: string;
        name: string;
        email: string;
      }>;
      const readiness = signoffSendReadiness({
        title: doc.title as string,
        bodyMarkdown: doc.body_markdown as string,
        signerCount: signers.length,
      });
      if (readiness.length > 0) {
        throw AppError.refusal(
          "This sign-off isn't ready to send — add a title, a document body, and at least one signatory.",
        );
      }

      // Mint tokens + email via the service-role admin client (tokens/events
      // have no client write policies). The raw token rides ONLY in the URL.
      const admin = createAdminClient();
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000).toISOString();
      const title = doc.title as string;

      for (const signer of signers) {
        const { raw, hash } = generateSignToken();
        assertSupabaseOk(
          await admin.from("signoff_tokens").insert({
            document_id: documentId,
            team_id: teamId,
            signer_id: signer.id,
            token_hash: hash,
            signer_email: signer.email,
            signer_name: signer.name,
            expires_at: expiresAt,
            created_by_user_id: userId,
          }),
        );
        const url = `${base}/signoff/${raw}`;
        await sendSignoffEmail(admin, {
          teamId,
          userId,
          documentId,
          kind: "signoff",
          toEmail: signer.email,
          subject: `Signature requested: ${title}`,
          bodyHtml: `<p>You've been asked to review and sign off on <strong>${escapeHtml(title)}</strong>.</p><p><a href="${url}">Open the document to sign</a></p><p>You'll confirm your identity with a one-time code emailed to you.</p>`,
          bodyText: `You've been asked to review and sign off on ${title}.\n\n${url}\n\nYou'll confirm your identity with a one-time code emailed to you.`,
        });
      }

      // Flip to sent (RLS client) AFTER the emails leave; log the event (admin).
      assertSupabaseOk(
        await supabase.from("signoff_documents").update({ status: "sent" }).eq("id", documentId),
      );
      await admin.from("signoff_events").insert({
        document_id: documentId,
        team_id: teamId,
        event_type: "sent",
        actor_user_id: userId,
        metadata: { signer_count: signers.length },
      });
      revalidatePath("/signoffs");
      revalidatePath(`/signoffs/${documentId}`);
    },
    { actionName: "sendSignoff" },
  );
}

/** Cancel a sent (in-flight) sign-off — revokes outstanding links, flips to
 *  canceled. A completed/declined sign-off is terminal and can't be canceled. */
export async function cancelSignoffAction(
  formData: FormData,
): Promise<ActionResult> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const documentId = fd.get("document_id");
      if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Missing document id.");
      }
      const { data: doc } = await supabase
        .from("signoff_documents")
        .select("id, team_id, status")
        .eq("id", documentId)
        .maybeSingle();
      if (!doc) throw AppError.notFound("Sign-off");
      const teamId = doc.team_id as string;
      await requireTeamAdmin(teamId);
      if (!["sent", "viewed"].includes(doc.status as string)) {
        throw AppError.refusal("Only an in-flight sign-off can be canceled.");
      }
      const admin = createAdminClient();
      await admin
        .from("signoff_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("document_id", documentId)
        .is("consumed_at", null)
        .is("revoked_at", null);
      assertSupabaseOk(
        await supabase.from("signoff_documents").update({ status: "canceled" }).eq("id", documentId),
      );
      await admin.from("signoff_events").insert({
        document_id: documentId,
        team_id: teamId,
        event_type: "canceled",
        actor_user_id: userId,
      });
      revalidatePath("/signoffs");
      revalidatePath(`/signoffs/${documentId}`);
    },
    { actionName: "cancelSignoff" },
  );
}

/** Pull team_id out of the JSON payload for the error-log context. */
function teamIdFromPayload(formData: FormData): string | null {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as { team_id?: string };
    return parsed.team_id ?? null;
  } catch {
    return null;
  }
}
