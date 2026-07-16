"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runSafeAction } from "@/lib/safe-action";
import { requireTeamAdmin } from "@/lib/team-context";
import { AppError, assertSupabaseOk } from "@/lib/errors";
import { generateInvoiceNumber } from "@/lib/invoice-utils";
import { paymentTermsLabel } from "@/lib/payment-terms";
import { proposalSchema, type ProposalInput } from "@/lib/schemas/proposal";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSignToken, TOKEN_TTL_DAYS } from "@/lib/proposals/tokens";
import { isValidProposalStatusTransition } from "@/lib/proposals/status";
import { sendProposalEmail } from "@/lib/messaging/send-proposal";
import { isProposalEditable } from "./allow-lists";

/**
 * Parse the structured form payload (the authoring form posts one JSON field —
 * nested line items don't map onto flat FormData) and validate it at the
 * boundary. Returns the typed input or throws a field-error-bearing AppError.
 */
function parsePayload(formData: FormData): ProposalInput {
  const raw = formData.get("payload");
  if (typeof raw !== "string" || raw === "") {
    throw new Error("Missing proposal payload.");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Malformed proposal payload.");
  }
  const parsed = proposalSchema.safeParse(json);
  if (!parsed.success) {
    // Zod v4 types issue paths as PropertyKey[]; symbols can't occur in our
    // schema, so narrow them away for fromZodError's field-error map.
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

/**
 * Defense-in-depth cross-checks over what RLS already enforces: the customer
 * must belong to the proposal's team, and the signer contact (if any) must
 * belong to that customer.
 */
async function assertCustomerAndSigner(
  supabase: SupabaseClient,
  input: ProposalInput,
): Promise<void> {
  const { data: customer } = await supabase
    .from("customers")
    .select("id, team_id")
    .eq("id", input.customer_id)
    .single();
  if (!customer || customer.team_id !== input.team_id) {
    throw AppError.refusal("Customer not found on this team.");
  }
  if (input.signer_contact_id) {
    const { data: contact } = await supabase
      .from("customer_contacts")
      .select("id, customer_id")
      .eq("id", input.signer_contact_id)
      .single();
    if (!contact || contact.customer_id !== input.customer_id) {
      throw AppError.refusal("Signer contact does not belong to this customer.");
    }
  }
}

/** Column payload shared by create + update. */
function proposalColumns(input: ProposalInput): Record<string, unknown> {
  return {
    customer_id: input.customer_id,
    signer_contact_id: input.signer_contact_id ?? null,
    title: input.title,
    issued_date: input.issued_date ?? undefined, // DB defaults CURRENT_DATE
    valid_until: input.valid_until ?? null,
    payment_terms_days: input.payment_terms_days ?? null,
    payment_terms_label:
      input.payment_terms_days != null
        ? paymentTermsLabel(input.payment_terms_days)
        : null,
    deposit_type: input.deposit_type,
    deposit_value: input.deposit_type === "none" ? null : (input.deposit_value ?? null),
    warranty_days: input.warranty_days ?? null,
    terms_notes: input.terms_notes ?? null,
  };
}

/**
 * Insert the line-item tree: top-level rows first (RETURNING preserves VALUES
 * order, so ids line up by index), then each item's phases referencing their
 * parent. Phase-sum and cap rules were validated at the boundary.
 */
async function insertLineItems(
  supabase: SupabaseClient,
  proposalId: string,
  teamId: string,
  items: ProposalInput["items"],
): Promise<void> {
  const parentRows = items.map((item, i) => ({
    proposal_id: proposalId,
    team_id: teamId,
    parent_line_item_id: null,
    sort_order: i,
    title: item.title,
    description: item.description ?? null,
    why_it_matters: item.whyItMatters ?? null,
    out_of_scope: item.outOfScope ?? null,
    definition_of_done: item.definitionOfDone ?? null,
    fixed_price: item.fixedPrice,
    is_capped: item.isCapped ?? false,
  }));
  const { data: inserted, error } = await supabase
    .from("proposal_line_items")
    .insert(parentRows)
    .select("id");
  assertSupabaseOk({ data: inserted, error });

  const phaseRows = items.flatMap((item, i) =>
    (item.phases ?? []).map((phase, j) => ({
      proposal_id: proposalId,
      team_id: teamId,
      parent_line_item_id: (inserted as Array<{ id: string }>)[i]!.id,
      sort_order: j,
      title: phase.title,
      description: phase.description ?? null,
      fixed_price: phase.fixedPrice,
      is_capped: false,
    })),
  );
  if (phaseRows.length > 0) {
    assertSupabaseOk(
      await supabase.from("proposal_line_items").insert(phaseRows),
    );
  }
}

export async function createProposalAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const input = parsePayload(formData);
      const { userId } = await requireTeamAdmin(input.team_id);
      await assertCustomerAndSigner(supabase, input);

      const { data: settings } = await supabase
        .from("team_settings")
        .select("proposal_prefix, proposal_next_num")
        .eq("team_id", input.team_id)
        .single();
      const prefix = settings?.proposal_prefix ?? "PROP";
      const nextNum = settings?.proposal_next_num ?? 1;
      const proposalNumber = generateInvoiceNumber(prefix, nextNum);

      const { data: proposal, error } = await supabase
        .from("proposals")
        .insert({
          team_id: input.team_id,
          user_id: userId,
          proposal_number: proposalNumber,
          ...proposalColumns(input),
        })
        .select("id")
        .single();
      assertSupabaseOk({ data: proposal, error });
      const proposalId = (proposal as { id: string }).id;

      await insertLineItems(supabase, proposalId, input.team_id, input.items);

      // Same accepted race caveat as invoice_next_num: a concurrent create
      // can collide, and UNIQUE(team_id, proposal_number) turns it into a
      // visible CONFLICT instead of a silent duplicate.
      await supabase
        .from("team_settings")
        .update({ proposal_next_num: nextNum + 1 })
        .eq("team_id", input.team_id);

      revalidatePath("/proposals");
      redirect(`/proposals/${proposalId}`);
    },
    {
      actionName: "createProposalAction",
      teamIdFrom: (fd) => {
        try {
          const parsed: unknown = JSON.parse((fd.get("payload") as string) ?? "");
          return (parsed as { team_id?: string })?.team_id ?? null;
        } catch {
          return null;
        }
      },
    },
  ) as unknown as void;
}

export async function updateProposalAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");
      const input = parsePayload(formData);

      // Authorize against the ROW's team, not the client-supplied one — then
      // require they match so a draft can't be moved across teams.
      const { data: existing } = await supabase
        .from("proposals")
        .select("id, team_id, status")
        .eq("id", proposalId)
        .single();
      if (!existing) throw new Error("Proposal not found.");
      await requireTeamAdmin(existing.team_id);
      if (existing.team_id !== input.team_id) {
        throw AppError.refusal("A proposal cannot change teams.");
      }
      if (!isProposalEditable(existing.status)) {
        throw AppError.refusal(
          "Only draft proposals can be edited. A sent proposal is frozen — create a new version instead.",
        );
      }
      await assertCustomerAndSigner(supabase, input);

      assertSupabaseOk(
        await supabase
          .from("proposals")
          .update(proposalColumns(input))
          .eq("id", proposalId),
      );

      // Replace the draft's line-item tree wholesale (phases cascade with
      // their parents). Draft-only, and the history triggers snapshot the
      // outgoing rows, so nothing audit-worthy is lost.
      assertSupabaseOk(
        await supabase
          .from("proposal_line_items")
          .delete()
          .eq("proposal_id", proposalId),
      );
      await insertLineItems(supabase, proposalId, existing.team_id, input.items);

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
      redirect(`/proposals/${proposalId}`);
    },
    "updateProposalAction",
  ) as unknown as void;
}

/**
 * Send a draft proposal for sign-off: freeze it (`draft → sent`), mint the
 * public access token (hash stored, raw only in the emailed URL), and email
 * the sign link to the signer contact through the outbox pipeline (SAL-036).
 */
export async function sendProposalAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase, userId }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");

      const { data: proposal } = await supabase
        .from("proposals")
        .select(
          "id, team_id, status, proposal_number, title, customer_id, signer_contact_id",
        )
        .eq("id", proposalId)
        .single();
      if (!proposal) throw new Error("Proposal not found.");
      await requireTeamAdmin(proposal.team_id as string);

      if (
        !isValidProposalStatusTransition(
          (proposal.status as string) ?? "",
          "sent",
        )
      ) {
        throw AppError.refusal(
          "Only a draft proposal can be sent. To revise a sent proposal, create a new version.",
        );
      }
      if (!proposal.signer_contact_id) {
        throw AppError.refusal(
          "Pick a signer contact before sending — the sign-off link and one-time code go to their email.",
        );
      }
      const { data: contact } = await supabase
        .from("customer_contacts")
        .select("id, name, email, customer_id")
        .eq("id", proposal.signer_contact_id as string)
        .single();
      if (!contact || contact.customer_id !== proposal.customer_id) {
        throw AppError.refusal("Signer contact does not belong to this customer.");
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      if (!baseUrl) {
        throw new Error(
          "NEXT_PUBLIC_APP_URL is not configured — the sign link cannot be built.",
        );
      }

      // Token rows have no INSERT policy — the admin client is the only
      // writer, keeping the hash out of any RLS-governed surface.
      const admin = createAdminClient();
      const { raw, hash } = generateSignToken();
      const expiresAt = new Date(
        Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      const { error: tokenError } = await admin
        .from("proposal_access_tokens")
        .insert({
          proposal_id: proposalId,
          team_id: proposal.team_id,
          token_hash: hash,
          signer_email: contact.email as string,
          signer_name: (contact.name as string | null) ?? null,
          expires_at: expiresAt.toISOString(),
          created_by_user_id: userId,
        });
      assertSupabaseOk({ data: null, error: tokenError });

      const signUrl = `${baseUrl}/sign/${raw}`;
      const number = proposal.proposal_number as string;
      const title = proposal.title as string;
      await sendProposalEmail(admin, {
        teamId: proposal.team_id as string,
        userId,
        proposalId,
        kind: "proposal",
        toEmail: contact.email as string,
        subject: `Proposal ${number}: ${title}`,
        bodyHtml: `<p>Hello ${contact.name ?? ""},</p><p>You have a proposal to review and sign off on: <strong>${title}</strong> (${number}).</p><p><a href="${signUrl}">Review &amp; sign the proposal</a></p><p>You can accept any combination of the line items — the link walks you through it. Before accepting, we'll email you a one-time code to confirm it's you.</p><p>This link expires on ${expiresAt.toISOString().slice(0, 10)}.</p>`,
        bodyText: `You have a proposal to review and sign off on: ${title} (${number}).\n\nReview & sign: ${signUrl}\n\nYou can accept any combination of the line items. Before accepting, we'll email you a one-time code to confirm it's you.\n\nThis link expires on ${expiresAt.toISOString().slice(0, 10)}.`,
      });

      // Status flip AFTER the email leaves — a failed send keeps the draft
      // editable. The trigger stamps sent_at; the send-lock allows the
      // transition (draft rows are freely mutable).
      assertSupabaseOk(
        await supabase
          .from("proposals")
          .update({ status: "sent" })
          .eq("id", proposalId),
      );
      await admin.from("proposal_events").insert({
        proposal_id: proposalId,
        team_id: proposal.team_id,
        event_type: "sent",
        actor_user_id: userId,
        actor_label: null,
        metadata: { to: contact.email },
      });

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
    },
    "sendProposalAction",
  ) as unknown as void;
}

/** Provider counter-signature — both parties on the acceptance record. */
export async function counterSignProposalAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase, userId }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");

      const { data: proposal } = await supabase
        .from("proposals")
        .select("id, team_id, status")
        .eq("id", proposalId)
        .single();
      if (!proposal) throw new Error("Proposal not found.");
      await requireTeamAdmin(proposal.team_id as string);

      const admin = createAdminClient();
      const { data: acceptance } = await admin
        .from("proposal_acceptances")
        .select("id, decision, provider_signed_at")
        .eq("proposal_id", proposalId)
        .eq("decision", "accepted")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .single();
      if (!acceptance) {
        throw AppError.refusal("No accepted sign-off to counter-sign yet.");
      }
      if (acceptance.provider_signed_at) {
        throw AppError.refusal("This acceptance is already counter-signed.");
      }

      // Acceptances have no UPDATE policy — only this admin-client path may
      // stamp the provider signature, and only into the two empty columns.
      const { error } = await admin
        .from("proposal_acceptances")
        .update({
          provider_signed_by_user_id: userId,
          provider_signed_at: new Date().toISOString(),
        })
        .eq("id", acceptance.id as string);
      assertSupabaseOk({ data: null, error });

      await admin.from("proposal_events").insert({
        proposal_id: proposalId,
        team_id: proposal.team_id,
        event_type: "countersigned",
        actor_user_id: userId,
        actor_label: null,
        metadata: {},
      });

      revalidatePath(`/proposals/${proposalId}`);
    },
    "counterSignProposalAction",
  ) as unknown as void;
}

export async function deleteProposalAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");

      const { data: existing } = await supabase
        .from("proposals")
        .select("id, team_id, status")
        .eq("id", proposalId)
        .single();
      if (!existing) throw new Error("Proposal not found.");
      await requireTeamAdmin(existing.team_id);
      if (existing.status !== "draft") {
        throw AppError.refusal(
          "Only draft proposals can be deleted. Sent and signed proposals are part of the audit record.",
        );
      }

      assertSupabaseOk(
        await supabase.from("proposals").delete().eq("id", proposalId),
      );

      revalidatePath("/proposals");
      redirect("/proposals");
    },
    "deleteProposalAction",
  ) as unknown as void;
}
