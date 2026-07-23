"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runSafeAction, type ActionResult } from "@/lib/safe-action";
import { requireTeamAdmin } from "@/lib/team-context";
import { AppError, assertSupabaseOk } from "@/lib/errors";
import { unwrapEmbed } from "@/lib/supabase/embed";
import { isSignoffDeletable, isSignoffEditable } from "@/lib/sign/readiness";
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
