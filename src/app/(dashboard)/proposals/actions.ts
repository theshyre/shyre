"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runSafeAction, type ActionResult } from "@/lib/safe-action";
import { requireTeamAdmin } from "@/lib/team-context";
import { AppError, assertSupabaseOk } from "@/lib/errors";
import { generateInvoiceNumber, calculateInvoiceTotals } from "@/lib/invoice-utils";
import { paymentTermsLabel, computeDueDate } from "@/lib/payment-terms";
import {
  roundMoney,
  PROPOSAL_ITEM_COLUMNS,
  type ProposalItemInput,
} from "@/lib/proposals/line-items";
import {
  proposalDraftSchema,
  type ProposalDraftInput,
} from "@/lib/schemas/proposal";
import {
  proposalSendReadiness,
  type ReadinessIssue,
} from "@/lib/proposals/readiness";
import { loadProposalRoster } from "@/lib/proposals/roster";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSignToken, TOKEN_TTL_DAYS } from "@/lib/proposals/tokens";
import { isValidProposalStatusTransition } from "@/lib/proposals/status";
import { sendProposalEmail } from "@/lib/messaging/send-proposal";
import { escapeHtml } from "@/lib/messaging/escape-html";
import { unwrapEmbed } from "@/lib/supabase/embed";
import { pickVersionCopyColumns } from "@/lib/proposals/version-copy";
import {
  isProposalEditable,
  isProposalDeletable,
  resolvePricingType,
} from "@/lib/proposals/allow-lists";

/**
 * Parse the structured form payload (the authoring form posts one JSON field —
 * nested line items don't map onto flat FormData) and validate it at the
 * boundary. Returns the typed input or throws a field-error-bearing AppError.
 */
function parsePayload(formData: FormData): ProposalDraftInput {
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
  // Save-as-you-go: create/update persist a draft with whatever the author has
  // (the lenient schema keeps only the corruption bounds). Completeness — a
  // title, ≥1 item, exact phase sums, a signer — is enforced at SEND time by
  // `proposalSendReadiness` + the phase-sum-on-send DB trigger.
  const parsed = proposalDraftSchema.safeParse(json);
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
  input: ProposalDraftInput,
): Promise<void> {
  const { data: customer } = await supabase
    .from("customers")
    .select("id, team_id")
    .eq("id", input.customer_id)
    .single();
  if (!customer || customer.team_id !== input.team_id) {
    throw AppError.refusal("Customer not found on this team.");
  }
  // Every signer (the primary and every roster entry) must be a contact of
  // this customer — the sign link + OTP go to their email.
  const signerIds = [
    ...new Set(
      [input.signer_contact_id ?? null, ...(input.signers ?? [])].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  if (signerIds.length > 0) {
    const { data: contacts } = await supabase
      .from("customer_contacts")
      .select("id, customer_id")
      .in("id", signerIds);
    const validForCustomer = new Set(
      (contacts ?? [])
        .filter((c) => c.customer_id === input.customer_id)
        .map((c) => c.id as string),
    );
    if (signerIds.some((id) => !validForCustomer.has(id))) {
      throw AppError.refusal(
        "A signer contact does not belong to this customer.",
      );
    }
  }
}

/** Ordered, de-duplicated roster contact ids (entry 0 = primary signer). */
function rosterContactIds(input: ProposalDraftInput): string[] {
  return [...new Set(input.signers ?? [])];
}

/** Column payload shared by create + update. */
function proposalColumns(input: ProposalDraftInput): Record<string, unknown> {
  const roster = rosterContactIds(input);
  return {
    customer_id: input.customer_id,
    // The primary signer mirrors roster[0] (back-compat + the single-signer
    // path); fall back to the explicit field when no roster is set.
    signer_contact_id: roster[0] ?? input.signer_contact_id ?? null,
    signing_mode: input.signing_mode ?? "first",
    // A draft may be unnamed; title is NOT NULL, so persist "" until the author
    // names it (send-readiness blocks an untitled proposal from going out).
    title: input.title ?? "",
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
    overview_markdown: input.overview_markdown ?? null,
    sign_theme: input.sign_theme ?? "light",
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
  items: ProposalDraftInput["items"],
): Promise<void> {
  // A work-in-progress draft may have no items yet — nothing to insert (and an
  // empty insert would be a needless round-trip / PostgREST error).
  if (items.length === 0) return;
  const parentRows = items.map((item, i) => ({
    proposal_id: proposalId,
    team_id: teamId,
    parent_line_item_id: null,
    sort_order: i,
    title: item.title,
    summary: item.summary ?? null,
    body_markdown: item.bodyMarkdown ?? null,
    description: item.description ?? null,
    why_it_matters: item.whyItMatters ?? null,
    out_of_scope: item.outOfScope ?? null,
    definition_of_done: item.definitionOfDone ?? null,
    fixed_price: item.fixedPrice,
    is_capped: item.isCapped ?? false,
    pricing_type: item.pricingType ?? "fixed_bid",
    hourly_rate: item.hourlyRate ?? null,
    estimate_low: item.estimateLow ?? null,
    estimate_high: item.estimateHigh ?? null,
    estimated_hours: item.estimatedHours ?? null,
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

/**
 * Persist the signer roster (draft-only; send-locked after). A roster row is
 * written only for 2+ signers — a single signer stays on the legacy path via
 * `signer_contact_id` (no roster row, NULL `signer_id` on its token, SAL-038
 * single-decision). Replaces the roster wholesale, like line items.
 */
async function saveSigners(
  supabase: SupabaseClient,
  proposalId: string,
  teamId: string,
  contactIds: string[],
): Promise<void> {
  assertSupabaseOk(
    await supabase
      .from("proposal_signers")
      .delete()
      .eq("proposal_id", proposalId),
  );
  if (contactIds.length < 2) return;
  assertSupabaseOk(
    await supabase.from("proposal_signers").insert(
      contactIds.map((contactId, i) => ({
        proposal_id: proposalId,
        team_id: teamId,
        contact_id: contactId,
        sort_order: i,
      })),
    ),
  );
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
      await saveSigners(
        supabase,
        proposalId,
        input.team_id,
        rosterContactIds(input),
      );

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
      await saveSigners(
        supabase,
        proposalId,
        existing.team_id,
        rosterContactIds(input),
      );

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
      redirect(`/proposals/${proposalId}`);
    },
    "updateProposalAction",
  ) as unknown as void;
}

/** Rebuild the top-level → phases tree from flat rows for the readiness check.
 *  Only the fields readiness inspects (title, price, phase breakdown) are
 *  carried; sort order groups phases under their parent. */
function buildReadinessItems(
  rows: Array<{
    id: string;
    parent_line_item_id: string | null;
    title: string | null;
    fixed_price: number | string;
    pricing_type?: string | null;
    hourly_rate?: number | string | null;
    estimate_low?: number | string | null;
    estimate_high?: number | string | null;
    estimated_hours?: number | string | null;
  }>,
): ProposalItemInput[] {
  const num = (v: number | string | null | undefined): number | null =>
    v == null ? null : Number(v);
  return rows
    .filter((r) => r.parent_line_item_id === null)
    .map((parent) => ({
      title: parent.title ?? "",
      fixedPrice: Number(parent.fixed_price),
      pricingType: resolvePricingType(parent.pricing_type),
      hourlyRate: num(parent.hourly_rate),
      estimateLow: num(parent.estimate_low),
      estimateHigh: num(parent.estimate_high),
      estimatedHours: num(parent.estimated_hours),
      phases: rows
        .filter((r) => r.parent_line_item_id === parent.id)
        .map((phase) => ({
          title: phase.title ?? "",
          fixedPrice: Number(phase.fixed_price),
        })),
    }));
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
          "id, team_id, status, proposal_number, title, customer_id, signer_contact_id, signing_mode",
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

      // Completeness gate (backstop to the detail-page checklist that already
      // disables Send): a draft persists in any state, but can't go out until
      // it's named, has items whose phases sum exactly, and names a signer.
      const { data: readinessRows } = await supabase
        .from("proposal_line_items")
        .select(PROPOSAL_ITEM_COLUMNS)
        .eq("proposal_id", proposalId)
        .order("sort_order");
      const blockers: ReadinessIssue[] = proposalSendReadiness({
        title: (proposal.title as string | null) ?? null,
        signerContactId: (proposal.signer_contact_id as string | null) ?? null,
        items: buildReadinessItems(readinessRows ?? []),
      });
      if (blockers.length > 0) {
        throw AppError.refusal(
          "This proposal isn't ready to send yet — finish the checklist on the proposal (a title, at least one line item with matching phase totals, and a signer contact) before sending.",
        );
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      if (!baseUrl) {
        throw new Error(
          "NEXT_PUBLIC_APP_URL is not configured — the sign link cannot be built.",
        );
      }

      // Build the recipient list. A roster (2+ signers) mints one token PER
      // signer — each carrying its `signer_id`, so the per-signer uniqueness
      // index applies. Otherwise the single-signer path uses signer_contact_id
      // (signer_id NULL, SAL-038 single-decision — unchanged behavior).
      interface Recipient {
        signerId: string | null;
        email: string;
        name: string | null;
      }
      const { data: rosterRows } = await supabase
        .from("proposal_signers")
        .select(
          "id, sort_order, customer_contacts(id, name, email, customer_id)",
        )
        .eq("proposal_id", proposalId)
        .order("sort_order");

      interface RosterContact {
        name: string | null;
        email: string | null;
        customer_id: string;
      }
      let recipients: Recipient[];
      if (rosterRows && rosterRows.length > 0) {
        recipients = rosterRows.map((row) => {
          const c = unwrapEmbed(
            row.customer_contacts as
              | RosterContact
              | RosterContact[]
              | null,
          );
          if (!c || c.customer_id !== proposal.customer_id) {
            throw AppError.refusal(
              "A signer contact does not belong to this customer.",
            );
          }
          return {
            signerId: row.id as string,
            email: c.email as string,
            name: c.name ?? null,
          };
        });
      } else {
        const { data: contact } = await supabase
          .from("customer_contacts")
          .select("id, name, email, customer_id")
          .eq("id", proposal.signer_contact_id as string)
          .single();
        if (!contact || contact.customer_id !== proposal.customer_id) {
          throw AppError.refusal(
            "Signer contact does not belong to this customer.",
          );
        }
        recipients = [
          {
            signerId: null,
            email: contact.email as string,
            name: (contact.name as string | null) ?? null,
          },
        ];
      }

      // Token rows have no INSERT policy — the admin client is the only writer,
      // keeping hashes out of any RLS-governed surface.
      const admin = createAdminClient();
      const expiresAt = new Date(
        Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      const number = proposal.proposal_number as string;
      const title = proposal.title as string;
      const safeTitle = escapeHtml(title);
      const allMustSign = (proposal.signing_mode as string) === "all";

      // One token + email per signer. A failed send on any recipient throws and
      // leaves the draft editable (status flips only after all have gone out).
      for (const recipient of recipients) {
        const { raw, hash } = generateSignToken();
        assertSupabaseOk({
          data: null,
          error: (
            await admin.from("proposal_access_tokens").insert({
              proposal_id: proposalId,
              team_id: proposal.team_id,
              token_hash: hash,
              signer_id: recipient.signerId,
              signer_email: recipient.email,
              signer_name: recipient.name,
              expires_at: expiresAt.toISOString(),
              created_by_user_id: userId,
            })
          ).error,
        });

        const signUrl = `${baseUrl}/sign/${raw}`;
        const safeName = escapeHtml(recipient.name ?? "");
        const coSignerNote = allMustSign
          ? "<p>This proposal requires every signer to authorize the same items, so your co-signers will each receive their own link.</p>"
          : "";
        const coSignerNoteText = allMustSign
          ? "\n\nThis proposal requires every signer to authorize the same items; your co-signers each receive their own link.\n"
          : "";
        await sendProposalEmail(admin, {
          teamId: proposal.team_id as string,
          userId,
          proposalId,
          kind: "proposal",
          toEmail: recipient.email,
          subject: `Proposal ${number}: ${title}`,
          bodyHtml: `<p>Hello ${safeName},</p><p>You have a proposal to review and sign off on: <strong>${safeTitle}</strong> (${number}).</p><p><a href="${signUrl}">Review &amp; sign the proposal</a></p>${coSignerNote}<p>Before accepting, we'll email you a one-time code to confirm it's you.</p><p>This link expires on ${expiresAt.toISOString().slice(0, 10)}.</p>`,
          bodyText: `You have a proposal to review and sign off on: ${title} (${number}).\n\nReview & sign: ${signUrl}${coSignerNoteText}\n\nBefore accepting, we'll email you a one-time code to confirm it's you.\n\nThis link expires on ${expiresAt.toISOString().slice(0, 10)}.`,
        });
      }

      // Status flip AFTER every email leaves — a failed send keeps the draft
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
        metadata: {
          recipients: recipients.length,
          signing_mode: proposal.signing_mode ?? "first",
        },
      });

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
    },
    "sendProposalAction",
  ) as unknown as void;
}

/**
 * Re-issue the outstanding sign link(s) for a sent proposal (batch 4a).
 * "The client lost the email / it went to spam" previously had NO recovery
 * short of New Version (which renumbers the doc and kills the thread).
 * Rotation, not resend-of-the-same-URL: raw tokens are never stored (only
 * sha256), so a fresh link is minted per pending signer and the old one is
 * revoked FIRST — a leaked older email goes dead the moment this runs.
 * Consumed (already-signed) links are untouched. Logged as `link_resent`
 * so the audit trail explains why a signer holds a dead link.
 */
export async function resendSignLinksAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const proposalId = fd.get("id");
      if (typeof proposalId !== "string" || proposalId === "") {
        throw new Error("Missing proposal id.");
      }
      const { data: proposal } = await supabase
        .from("proposals")
        .select("id, team_id, status, proposal_number, title, signing_mode")
        .eq("id", proposalId)
        .single();
      if (!proposal) throw new Error("Proposal not found.");
      await requireTeamAdmin(proposal.team_id as string);
      const status = (proposal.status as string) ?? "";
      if (status !== "sent" && status !== "viewed") {
        throw AppError.refusal(
          "Only a sent proposal's links can be re-issued.",
        );
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!baseUrl) {
        throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
      }

      const admin = createAdminClient();
      const { data: pending } = await admin
        .from("proposal_access_tokens")
        .select("id, signer_id, signer_email, signer_name")
        .eq("proposal_id", proposalId)
        .is("consumed_at", null)
        .is("revoked_at", null);
      const tokens = pending ?? [];
      if (tokens.length === 0) {
        throw AppError.refusal("No outstanding sign links to re-issue.");
      }

      const expiresAt = new Date(
        Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      const number = proposal.proposal_number as string;
      const title = proposal.title as string;
      const safeTitle = escapeHtml(title);

      for (const tok of tokens) {
        // Revoke FIRST so the old link is dead even if the new send fails —
        // fail toward "no live link" rather than two live links.
        assertSupabaseOk(
          await admin
            .from("proposal_access_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", tok.id),
        );
        const { raw, hash } = generateSignToken();
        assertSupabaseOk({
          data: null,
          error: (
            await admin.from("proposal_access_tokens").insert({
              proposal_id: proposalId,
              team_id: proposal.team_id,
              token_hash: hash,
              signer_id: tok.signer_id,
              signer_email: tok.signer_email,
              signer_name: tok.signer_name,
              expires_at: expiresAt.toISOString(),
              created_by_user_id: userId,
            })
          ).error,
        });
        const signUrl = `${baseUrl}/sign/${raw}`;
        const safeName = escapeHtml((tok.signer_name as string | null) ?? "");
        await sendProposalEmail(admin, {
          teamId: proposal.team_id as string,
          userId,
          proposalId,
          kind: "proposal",
          toEmail: tok.signer_email as string,
          subject: `Proposal ${number}: ${title}`,
          bodyHtml: `<p>Hello ${safeName},</p><p>Here is a fresh link to review and sign off on: <strong>${safeTitle}</strong> (${number}).</p><p><a href="${signUrl}">Review &amp; sign the proposal</a></p><p>Any earlier link for this proposal no longer works. Before accepting, we'll email you a one-time code to confirm it's you.</p><p>This link expires on ${expiresAt.toISOString().slice(0, 10)}.</p>`,
          bodyText: `Here is a fresh link to review and sign off on: ${title} (${number}).\n\nReview & sign: ${signUrl}\n\nAny earlier link for this proposal no longer works. Before accepting, we'll email you a one-time code to confirm it's you.\n\nThis link expires on ${expiresAt.toISOString().slice(0, 10)}.`,
        });
      }

      await admin.from("proposal_events").insert({
        proposal_id: proposalId,
        team_id: proposal.team_id,
        event_type: "link_resent",
        actor_user_id: userId,
        actor_label: null,
        metadata: { recipients: tokens.length },
      });

      revalidatePath(`/proposals/${proposalId}`);
    },
    "resendSignLinksAction",
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

interface AcceptedItemRow {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  description: string | null;
  fixed_price: number | string;
  pricing_type: string;
  hourly_rate: number | string | null;
  estimated_hours: number | string | null;
  converted_project_id: string | null;
  invoiced_at: string | null;
}

/** The latest accepted decision's selected top-level item ids, or a refusal
 *  message when there is no accepted sign-off. */
async function loadAcceptedSelection(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<{
  selectedIds: Set<string>;
  taxRate: number | null;
  items: AcceptedItemRow[];
}> {
  const { data: acceptanceRows } = await supabase
    .from("proposal_acceptances")
    .select("selected_line_item_ids, decision, tax_rate")
    .eq("proposal_id", proposalId)
    .eq("decision", "accepted")
    .order("occurred_at", { ascending: false })
    .limit(1);
  const acceptance = acceptanceRows?.[0];
  if (!acceptance) {
    throw AppError.refusal("No accepted sign-off on this proposal yet.");
  }
  const { data: itemRows } = await supabase
    .from("proposal_line_items")
    .select(
      "id, parent_line_item_id, sort_order, title, description, fixed_price, pricing_type, hourly_rate, estimated_hours, converted_project_id, invoiced_at",
    )
    .eq("proposal_id", proposalId)
    .order("sort_order");
  return {
    selectedIds: new Set(
      (acceptance.selected_line_item_ids as string[]) ?? [],
    ),
    // The rate frozen at signing (null on legacy acceptances taken before the
    // snapshot column existed — the caller falls back to the team default).
    taxRate:
      acceptance.tax_rate != null ? Number(acceptance.tax_rate) : null,
    items: (itemRows ?? []) as AcceptedItemRow[],
  };
}

/**
 * Convert the accepted line items into projects: one project per accepted
 * top-level item; a phased item becomes a project with its phases as
 * sub-projects (`parent_project_id`). Each created project id is linked back
 * onto its line item, and the proposal moves `accepted → converted`.
 */
export async function convertProposalAction(formData: FormData): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase, userId }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");

      const { data: proposal } = await supabase
        .from("proposals")
        .select("id, team_id, status, customer_id, proposal_number")
        .eq("id", proposalId)
        .single();
      if (!proposal) throw new Error("Proposal not found.");
      await requireTeamAdmin(proposal.team_id as string);
      if (
        !isValidProposalStatusTransition(
          (proposal.status as string) ?? "",
          "converted",
        )
      ) {
        throw AppError.refusal(
          "Only an accepted proposal can be converted into projects.",
        );
      }

      const { selectedIds, items } = await loadAcceptedSelection(
        supabase,
        proposalId,
      );
      const accepted = items.filter(
        (item) =>
          item.parent_line_item_id === null &&
          selectedIds.has(item.id) &&
          item.converted_project_id === null,
      );
      if (accepted.length === 0) {
        throw AppError.refusal(
          "Every accepted line item has already been converted.",
        );
      }

      let createdCount = 0;
      for (const item of accepted) {
        // Parent project = the accepted line item.
        // Map the pricing type onto the project's billing:
        //  - fixed_bid → the client pays the quoted price (billed via the
        //    proposal); time is tracked for profitability, never hourly-billed
        //    (default_billable=false).
        //  - estimate/NTE/T&M → an HOURLY project billed from time entries at
        //    the agreed rate; the estimate rides along as a soft budget.
        const pt = item.pricing_type ?? "fixed_bid";
        const billingFields =
          pt === "fixed_bid"
            ? {
                default_billable: false,
                billing_mode: "fixed_bid",
                fixed_price: item.fixed_price,
              }
            : {
                default_billable: true,
                billing_mode: "hourly",
                hourly_rate: item.hourly_rate,
                budget_hours: item.estimated_hours,
                // NTE: the cap (anchor = fixed_price) becomes a lifetime dollar
                // budget the burn-vs-budget tooling alerts against.
                ...(pt === "estimate_nte"
                  ? { budget_dollars: item.fixed_price }
                  : {}),
              };
        const { data: project, error } = await supabase
          .from("projects")
          .insert({
            team_id: proposal.team_id,
            user_id: userId,
            customer_id: proposal.customer_id,
            is_internal: false,
            ...billingFields,
            name: item.title,
            description: item.description,
          })
          .select("id")
          .single();
        assertSupabaseOk({ data: project, error });
        const projectId = (project as { id: string }).id;
        createdCount += 1;

        assertSupabaseOk(
          await supabase
            .from("proposal_line_items")
            .update({ converted_project_id: projectId })
            .eq("id", item.id),
        );

        // Phases → sub-projects under the parent (one level, same customer —
        // the projects triggers enforce both).
        const phases = items.filter(
          (row) => row.parent_line_item_id === item.id,
        );
        for (const phase of phases) {
          const { data: sub, error: subError } = await supabase
            .from("projects")
            .insert({
              team_id: proposal.team_id,
              user_id: userId,
              customer_id: proposal.customer_id,
              is_internal: false,
              default_billable: false,
              billing_mode: "fixed_bid",
              fixed_price: phase.fixed_price,
              name: phase.title,
              description: phase.description,
              parent_project_id: projectId,
            })
            .select("id")
            .single();
          assertSupabaseOk({ data: sub, error: subError });
          createdCount += 1;
          assertSupabaseOk(
            await supabase
              .from("proposal_line_items")
              .update({
                converted_project_id: (sub as { id: string }).id,
              })
              .eq("id", phase.id),
          );
        }
      }

      assertSupabaseOk(
        await supabase
          .from("proposals")
          .update({ status: "converted" })
          .eq("id", proposalId),
      );
      const admin = createAdminClient();
      await admin.from("proposal_events").insert({
        proposal_id: proposalId,
        team_id: proposal.team_id,
        event_type: "converted",
        actor_user_id: userId,
        actor_label: null,
        metadata: { projects_created: createdCount },
      });

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
      revalidatePath("/projects");
    },
    "convertProposalAction",
  ) as unknown as void;
}

/**
 * Bill the accepted fixed prices: create a draft invoice whose line items are
 * MANUAL lines (no time-entry / expense source — the shape the
 * `invoice_line_items_source_mutex` CHECK reserves for ad-hoc charges), one
 * per accepted, not-yet-billed line item. Payment terms carry over from the
 * proposal; `invoiced_at` locks each billed item against double-billing.
 */
export async function createInvoiceFromProposalAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase, userId }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");
      // "full" (default) bills the accepted items; "deposit" bills the
      // deposit term as ONE manual line (2026-07-18 decision, SAL-049).
      const mode = formData.get("mode") === "deposit" ? "deposit" : "full";

      const { data: proposal } = await supabase
        .from("proposals")
        .select(
          "id, team_id, status, customer_id, proposal_number, title, currency, payment_terms_days, payment_terms_label, deposit_type, deposit_value, accepted_total, deposit_invoice_id",
        )
        .eq("id", proposalId)
        .single();
      if (!proposal) throw new Error("Proposal not found.");
      await requireTeamAdmin(proposal.team_id as string);
      const proposalStatus = (proposal.status as string) ?? "";
      if (proposalStatus !== "accepted" && proposalStatus !== "converted") {
        throw AppError.refusal(
          "Only an accepted proposal can be billed — get the sign-off first.",
        );
      }

      const { selectedIds, taxRate: acceptedTaxRate, items } =
        await loadAcceptedSelection(supabase, proposalId);

      if (mode === "deposit") {
        const depositType = (proposal.deposit_type as string) ?? "none";
        const depositValue =
          proposal.deposit_value != null ? Number(proposal.deposit_value) : null;
        const acceptedTotal =
          proposal.accepted_total != null
            ? Number(proposal.accepted_total)
            : null;
        if (depositType === "none" || !depositValue || !acceptedTotal) {
          throw AppError.refusal("This proposal has no deposit term to bill.");
        }
        if (proposal.deposit_invoice_id) {
          throw AppError.refusal(
            "The deposit has already been billed for this proposal.",
          );
        }
        const depositAmount = roundMoney(
          depositType === "percent"
            ? (acceptedTotal * depositValue) / 100
            : Math.min(depositValue, acceptedTotal),
        );
        if (depositAmount <= 0) {
          throw AppError.refusal("The deposit term computes to zero.");
        }

        const { data: settings } = await supabase
          .from("team_settings")
          .select("invoice_prefix, invoice_next_num, tax_rate")
          .eq("team_id", proposal.team_id as string)
          .single();
        const prefix = settings?.invoice_prefix ?? "INV";
        const nextNum = settings?.invoice_next_num ?? 1;
        const taxRate = acceptedTaxRate ?? Number(settings?.tax_rate ?? 0);
        const number = proposal.proposal_number as string;
        const depositLabel =
          depositType === "percent" ? `${depositValue}%` : "fixed";
        const line = {
          description: `Deposit (${depositLabel}) — ${number}: ${proposal.title as string}`,
          quantity: 1,
          unitPrice: depositAmount,
          amount: depositAmount,
        };
        const totals = calculateInvoiceTotals([line], taxRate);
        const termsDays =
          (proposal.payment_terms_days as number | null) ?? null;
        const dueDate =
          termsDays != null
            ? computeDueDate(new Date().toISOString().slice(0, 10), termsDays)
            : null;

        const { data: invoice, error } = await supabase
          .from("invoices")
          .insert({
            team_id: proposal.team_id,
            user_id: userId,
            customer_id: proposal.customer_id,
            proposal_id: proposal.id,
            currency: (proposal.currency as string | null) ?? "USD",
            invoice_number: generateInvoiceNumber(prefix, nextNum),
            due_date: dueDate,
            status: "draft",
            subtotal: totals.subtotal,
            discount_amount: totals.discountAmount,
            discount_rate: totals.discountRate,
            tax_rate: totals.taxRate,
            tax_amount: totals.taxAmount,
            total: totals.total,
            notes: `Deposit per proposal ${number}: ${proposal.title as string}`,
            grouping_mode: "detailed",
            payment_terms_days: termsDays,
            payment_terms_label:
              (proposal.payment_terms_label as string | null) ??
              (termsDays != null ? paymentTermsLabel(termsDays) : null),
          })
          .select("id")
          .single();
        assertSupabaseOk({ data: invoice, error });
        const depositInvoiceId = (invoice as { id: string }).id;
        assertSupabaseOk(
          await supabase.from("invoice_line_items").insert({
            invoice_id: depositInvoiceId,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            amount: line.amount,
            time_entry_id: null,
            expense_id: null,
            proposal_line_item_id: null,
          }),
        );
        // CLAIM the one-deposit slot conditionally (SAL-040 claim doctrine):
        // if a concurrent deposit-bill won the slot first, delete OUR invoice
        // (lines cascade) and refuse — never two live deposit invoices.
        const { data: claimedProposal } = await supabase
          .from("proposals")
          .update({ deposit_invoice_id: depositInvoiceId })
          .eq("id", proposalId)
          .is("deposit_invoice_id", null)
          .select("id");
        if (!claimedProposal || claimedProposal.length === 0) {
          await supabase.from("invoices").delete().eq("id", depositInvoiceId);
          throw AppError.refusal(
            "The deposit has already been billed for this proposal.",
          );
        }
        await supabase
          .from("team_settings")
          .update({ invoice_next_num: nextNum + 1 })
          .eq("team_id", proposal.team_id as string);

        revalidatePath("/invoices");
        revalidatePath(`/proposals/${proposalId}`);
        redirect(`/invoices/${depositInvoiceId}`);
      }
      const candidateIds = items
        .filter(
          (item) =>
            item.parent_line_item_id === null &&
            // Only FIXED-BID items bill as a lump-sum line here; estimate/NTE/
            // T&M items are hourly-billed from time entries by the invoice
            // builder, so they never flow through the proposal invoice path.
            (item.pricing_type ?? "fixed_bid") === "fixed_bid" &&
            selectedIds.has(item.id) &&
            item.invoiced_at === null,
        )
        .map((item) => item.id);
      if (candidateIds.length === 0) {
        throw AppError.refusal(
          "Every accepted line item has already been invoiced.",
        );
      }

      // Claim the items ATOMICALLY: the `invoiced_at IS NULL` predicate on the
      // UPDATE means two concurrent "Bill proposal" clicks can't both stamp the
      // same item — only one wins the row, the other claims nothing and is
      // refused below. This is the same consume-first guard as the sign token
      // (SAL-038); a read-then-stamp loop had a double-bill race.
      const nowIso = new Date().toISOString();
      const { data: claimedRows, error: claimError } = await supabase
        .from("proposal_line_items")
        .update({ invoiced_at: nowIso })
        .in("id", candidateIds)
        .is("invoiced_at", null)
        .select("id, title, fixed_price");
      assertSupabaseOk({ data: claimedRows, error: claimError });
      const claimed = (claimedRows ?? []) as Array<{
        id: string;
        title: string;
        fixed_price: number;
      }>;
      if (claimed.length === 0) {
        throw AppError.refusal(
          "Every accepted line item has already been invoiced.",
        );
      }
      const claimedIds = claimed.map((c) => c.id);

      // Everything after the claim runs under a rollback guard: if invoice
      // assembly fails, release the lock we just took so the work is billable
      // again rather than stranded "invoiced" against a non-existent invoice.
      let invoiceId: string;
      try {
        const { data: settings } = await supabase
          .from("team_settings")
          .select("invoice_prefix, invoice_next_num, tax_rate")
          .eq("team_id", proposal.team_id as string)
          .single();
        const prefix = settings?.invoice_prefix ?? "INV";
        const nextNum = settings?.invoice_next_num ?? 1;
        // Bill at the rate frozen when the client signed; only fall back to the
        // live team default for legacy acceptances taken before the snapshot.
        const taxRate =
          acceptedTaxRate ?? Number(settings?.tax_rate ?? 0);
        const invoiceNumber = generateInvoiceNumber(prefix, nextNum);

        const number = proposal.proposal_number as string;
        const lines: Array<{
          proposalLineItemId: string | null;
          description: string;
          quantity: number;
          unitPrice: number;
          amount: number;
        }> = claimed.map((item) => ({
          proposalLineItemId: item.id as string | null,
          description: `${number} — ${item.title}`,
          quantity: 1,
          unitPrice: roundMoney(Number(item.fixed_price)),
          amount: roundMoney(Number(item.fixed_price)),
        }));

        // NET OUT a billed (non-void) deposit as a negative manual line —
        // both invoices tax their subtotals at the same frozen rate, so
        // netting pre-tax keeps the combined tax exactly right and the
        // client never pays the deposit twice (SAL-049).
        if (proposal.deposit_invoice_id) {
          const { data: depositInvoice } = await supabase
            .from("invoices")
            .select("id, invoice_number, subtotal, status")
            .eq("id", proposal.deposit_invoice_id as string)
            .single();
          if (depositInvoice && depositInvoice.status !== "void") {
            const depositSubtotal = roundMoney(
              Number(depositInvoice.subtotal ?? 0),
            );
            if (depositSubtotal > 0) {
              lines.push({
                proposalLineItemId: null,
                description: `Less deposit billed (${depositInvoice.invoice_number as string})`,
                quantity: 1,
                unitPrice: -depositSubtotal,
                amount: -depositSubtotal,
              });
            }
          }
        }
        const totals = calculateInvoiceTotals(lines, taxRate);

        // Terms carry over from the proposal (the cascade's highest-priority
        // source); due date derives from today + net-N when terms are set.
        const termsDays =
          (proposal.payment_terms_days as number | null) ?? null;
        const today = new Date().toISOString().slice(0, 10);
        const dueDate =
          termsDays != null ? computeDueDate(today, termsDays) : null;

        const { data: invoice, error } = await supabase
          .from("invoices")
          .insert({
            team_id: proposal.team_id,
            user_id: userId,
            customer_id: proposal.customer_id,
            proposal_id: proposal.id,
            currency: (proposal.currency as string | null) ?? "USD",
            invoice_number: invoiceNumber,
            due_date: dueDate,
            status: "draft",
            subtotal: totals.subtotal,
            discount_amount: totals.discountAmount,
            discount_rate: totals.discountRate,
            tax_rate: totals.taxRate,
            tax_amount: totals.taxAmount,
            total: totals.total,
            notes: `Fixed-price work per proposal ${number}: ${proposal.title as string}`,
            grouping_mode: "detailed",
            payment_terms_days: termsDays,
            payment_terms_label:
              (proposal.payment_terms_label as string | null) ??
              (termsDays != null ? paymentTermsLabel(termsDays) : null),
          })
          .select("id")
          .single();
        assertSupabaseOk({ data: invoice, error });
        invoiceId = (invoice as { id: string }).id;

        assertSupabaseOk(
          await supabase.from("invoice_line_items").insert(
            lines.map((line) => ({
              invoice_id: invoiceId,
              description: line.description,
              quantity: line.quantity,
              unit_price: line.unitPrice,
              amount: line.amount,
              time_entry_id: null,
              expense_id: null,
              // Structured back-link: reconciliation and the void/delete
              // unlock triggers key off this instead of parsing the text.
              proposal_line_item_id: line.proposalLineItemId,
            })),
          ),
        );

        await supabase
          .from("team_settings")
          .update({ invoice_next_num: nextNum + 1 })
          .eq("team_id", proposal.team_id as string);
      } catch (err) {
        // Release the double-bill lock we claimed above so the work is
        // billable again rather than stranded against no invoice. redirect()
        // is deliberately OUTSIDE this try — its NEXT_REDIRECT throw is the
        // success path and must never trigger a rollback.
        await supabase
          .from("proposal_line_items")
          .update({ invoiced_at: null })
          .in("id", claimedIds);
        throw err;
      }

      revalidatePath("/invoices");
      revalidatePath(`/proposals/${proposalId}`);
      redirect(`/invoices/${invoiceId}`);
    },
    "createInvoiceFromProposalAction",
  ) as unknown as void;
}

/**
 * Freeze-and-reissue versioning (the invoice void→re-bill doctrine): a sent
 * proposal's content is immutable, so a revision is a NEW draft that copies
 * the document, bumps `version_number`, and links `supersedes_proposal_id`.
 * The old sent/viewed proposal flips to `superseded` and its outstanding sign
 * links are revoked — the old URL dies the moment a replacement exists. A
 * declined source stays `declined` (its own terminal record) but still links.
 * Signed work (accepted/converted) is never superseded — that's a new deal.
 */
export async function createProposalVersionAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase, userId }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");

      const { data: source } = await supabase
        .from("proposals")
        .select("*")
        .eq("id", proposalId)
        .single();
      if (!source) throw new Error("Proposal not found.");
      await requireTeamAdmin(source.team_id as string);

      const sourceStatus = (source.status as string) ?? "";
      const canSupersede = isValidProposalStatusTransition(
        sourceStatus,
        "superseded",
      );
      if (sourceStatus === "draft") {
        throw AppError.refusal(
          "A draft is still editable — edit it directly instead of versioning.",
        );
      }
      if (!canSupersede && sourceStatus !== "declined") {
        throw AppError.refusal(
          "Signed proposals can't be revised — draft a new proposal for the follow-on work.",
        );
      }

      const { data: settings } = await supabase
        .from("team_settings")
        .select("proposal_prefix, proposal_next_num")
        .eq("team_id", source.team_id as string)
        .single();
      const prefix = settings?.proposal_prefix ?? "PROP";
      const nextNum = settings?.proposal_next_num ?? 1;

      const { data: created, error } = await supabase
        .from("proposals")
        .insert({
          team_id: source.team_id,
          user_id: userId,
          // Every copied content/terms column (signing_mode included — a
          // multi-signer proposal must stay multi-signer across a version
          // bump). VERSION_COPY_COLUMNS is the single audited list, so a new
          // proposals column can't silently drop out of version copies.
          // issued_date is deliberately NOT copied (DB default = today).
          ...pickVersionCopyColumns(source as Record<string, unknown>),
          proposal_number: generateInvoiceNumber(prefix, nextNum),
          version_number: ((source.version_number as number) ?? 1) + 1,
          supersedes_proposal_id: proposalId,
        })
        .select("id")
        .single();
      assertSupabaseOk({ data: created, error });
      const newId = (created as { id: string }).id;

      // Copy the item tree (parents first, then phases remapped).
      const { data: itemRows } = await supabase
        .from("proposal_line_items")
        .select(PROPOSAL_ITEM_COLUMNS)
        .eq("proposal_id", proposalId)
        .order("sort_order");
      const rows = (itemRows ?? []) as Array<Record<string, unknown>>;
      const parents = rows.filter((r) => r.parent_line_item_id === null);
      if (parents.length > 0) {
        const { data: newParents, error: parentError } = await supabase
          .from("proposal_line_items")
          .insert(
            parents.map((r, i) => ({
              proposal_id: newId,
              team_id: source.team_id,
              parent_line_item_id: null,
              sort_order: i,
              title: r.title,
              summary: r.summary,
              body_markdown: r.body_markdown,
              description: r.description,
              why_it_matters: r.why_it_matters,
              out_of_scope: r.out_of_scope,
              definition_of_done: r.definition_of_done,
              fixed_price: r.fixed_price,
              is_capped: r.is_capped,
              pricing_type: r.pricing_type,
              hourly_rate: r.hourly_rate,
              estimate_low: r.estimate_low,
              estimate_high: r.estimate_high,
              estimated_hours: r.estimated_hours,
            })),
          )
          .select("id");
        assertSupabaseOk({ data: newParents, error: parentError });
        const phaseRows = parents.flatMap((parent, i) =>
          rows
            .filter((r) => r.parent_line_item_id === parent.id)
            .map((phase, j) => ({
              proposal_id: newId,
              team_id: source.team_id,
              parent_line_item_id: (newParents as Array<{ id: string }>)[i]!.id,
              sort_order: j,
              title: phase.title,
              description: phase.description,
              fixed_price: phase.fixed_price,
              is_capped: false,
            })),
        );
        if (phaseRows.length > 0) {
          assertSupabaseOk(
            await supabase.from("proposal_line_items").insert(phaseRows),
          );
        }
      }

      // Copy the multi-signer roster (proposal_signers) so a versioned proposal
      // keeps ALL its co-signers — the insert above only carries the primary via
      // signer_contact_id. Without this, a 2+-signer proposal reset to just the
      // primary on every version bump.
      const { data: sourceSigners } = await supabase
        .from("proposal_signers")
        .select("contact_id, sort_order")
        .eq("proposal_id", proposalId)
        .order("sort_order");
      const signerRows = (sourceSigners ?? []) as Array<{
        contact_id: string;
        sort_order: number;
      }>;
      if (signerRows.length > 0) {
        assertSupabaseOk(
          await supabase.from("proposal_signers").insert(
            signerRows.map((s) => ({
              proposal_id: newId,
              team_id: source.team_id,
              contact_id: s.contact_id,
              sort_order: s.sort_order,
            })),
          ),
        );
      }

      const admin = createAdminClient();
      if (canSupersede) {
        // Kill the live document: status flip + revoke outstanding links.
        assertSupabaseOk(
          await supabase
            .from("proposals")
            .update({ status: "superseded" })
            .eq("id", proposalId),
        );
        await admin
          .from("proposal_access_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("proposal_id", proposalId)
          .is("revoked_at", null);
      }
      await admin.from("proposal_events").insert({
        proposal_id: proposalId,
        team_id: source.team_id,
        event_type: "superseded",
        actor_user_id: userId,
        actor_label: null,
        metadata: { new_proposal_id: newId },
      });

      await supabase
        .from("team_settings")
        .update({ proposal_next_num: nextNum + 1 })
        .eq("team_id", source.team_id as string);

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
      redirect(`/proposals/${newId}/edit`);
    },
    "createProposalVersionAction",
  ) as unknown as void;
}

/**
 * Of the given proposal ids, the subset with at least one recorded acceptance
 * (signature). `superseded` is only reachable from draft/sent/viewed, but a
 * multi-signer proposal can carry a partial (e.g. 1-of-2) signature into the
 * superseded state; proposal_acceptances is immutable and CASCADEs on delete,
 * so such a proposal must never be hard-deleted through its parent. This gates
 * deletion at the action layer so the caller sees a clean refusal / honest skip
 * instead of the DB guard's raw CONFLICT. Empty input short-circuits.
 */
async function proposalIdsWithAcceptances(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("proposal_acceptances")
    .select("proposal_id")
    .in("proposal_id", ids);
  if (error) throw AppError.fromSupabase(error);
  return new Set(
    ((data ?? []) as Array<{ proposal_id: string }>).map((r) => r.proposal_id),
  );
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
      if (!isProposalDeletable(existing.status)) {
        throw AppError.refusal(
          "Only draft or superseded proposals can be deleted. Sent and signed proposals are part of the audit record.",
        );
      }
      if (existing.status === "superseded") {
        const withSignature = await proposalIdsWithAcceptances(supabase, [
          proposalId,
        ]);
        if (withSignature.has(proposalId)) {
          throw AppError.refusal(
            "This proposal has a recorded signature and is part of the audit record — it can't be deleted.",
          );
        }
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

export interface BulkDeleteProposalsCounts {
  deleted: number;
  skipped: number;
}

/**
 * `runSafeAction` only ever resolves `{success:true}` or
 * `{success:false,error}` — no generic data channel — so this widens the
 * success branch locally with the honest delete/skip counts instead of
 * changing the shared helper (every other proposals action stays on the
 * plain `ActionResult` shape).
 */
export type BulkDeleteProposalsResult =
  | (Extract<ActionResult, { success: true }> & BulkDeleteProposalsCounts)
  | Extract<ActionResult, { success: false }>;

/**
 * Bulk hard-delete for the proposals list's multi-select strip — the
 * primary need is clearing out test/junk drafts and superseded versions in
 * one pass. Mirrors `deleteProposalAction`'s gating (requireTeamAdmin +
 * isProposalDeletable + the signed-superseded exclusion), but instead of
 * refusing the whole batch on one ineligible row, it deletes what it can and
 * reports an honest `{ deleted, skipped }` count: a
 * sent/viewed/accepted/declined/converted proposal — or a superseded one that
 * still carries a recorded signature — is part of the audit record and is
 * silently excluded, never force-deleted. Every id is re-checked server-side
 * against the DB — the table's disabled checkboxes on non-deletable rows are a
 * UX nicety, not the authority.
 */
export async function bulkDeleteProposalsAction(
  formData: FormData,
): Promise<BulkDeleteProposalsResult> {
  const counts: BulkDeleteProposalsCounts = { deleted: 0, skipped: 0 };
  const outcome = await runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const ids = [
        ...new Set(formData.getAll("id").map(String).filter(Boolean)),
      ];
      if (ids.length === 0) return;

      const { data: rows, error } = await supabase
        .from("proposals")
        .select("id, team_id, status")
        .in("id", ids);
      if (error) throw AppError.fromSupabase(error);
      const found = (rows ?? []) as Array<{
        id: string;
        team_id: string;
        status: string;
      }>;

      // Defense-in-depth: confirm admin on every distinct team represented
      // in the selection. RLS already scopes visible proposals to teams the
      // viewer administers, so this should never actually deny a
      // legitimately-selected row — it exists so a tampered id list can't
      // slip a foreign team's proposal past the client-side gate.
      const teamIds = [...new Set(found.map((r) => r.team_id))];
      for (const teamId of teamIds) {
        await requireTeamAdmin(teamId);
      }

      // Status gate first, then exclude any superseded row that carries a real
      // signature — its immutable acceptance would CASCADE-delete with the
      // parent. Those become honest skips, never a force-delete.
      const statusDeletable = found.filter((r) =>
        isProposalDeletable(r.status),
      );
      const withSignature = await proposalIdsWithAcceptances(
        supabase,
        statusDeletable.map((r) => r.id),
      );
      const deletable = statusDeletable.filter((r) => !withSignature.has(r.id));
      if (deletable.length > 0) {
        assertSupabaseOk(
          await supabase
            .from("proposals")
            .delete()
            .in(
              "id",
              deletable.map((r) => r.id),
            ),
        );
        revalidatePath("/proposals");
      }

      // Honest accounting: anything requested that didn't come back
      // deleted — wrong status, not found, or outside the caller's teams —
      // is a skip, never a silent success.
      counts.deleted = deletable.length;
      counts.skipped = ids.length - deletable.length;
    },
    "bulkDeleteProposalsAction",
  );

  if (!outcome.success) return outcome;
  return { success: true, ...counts };
}

/** Minimum characters for the override justification — an override waives a
 *  co-signer's decision, so it must carry a real reason for the audit trail,
 *  not a rubber-stamp. */
const OVERRIDE_NOTE_MIN = 5;

/**
 * Owner/admin override of a stalled multi-signer sign-off.
 *
 * When a proposal is in `all` mode and one signer will never sign (they've
 * left the company, the deal changed, whatever), the deal is stuck: the
 * status can't reach `accepted` because completion requires every rostered
 * signer. This lets an owner/admin complete it on the strength of the
 * signatures already in hand — flipping to `accepted` with the primary
 * signer's bound total — while recording WHO overrode, WHY (a required
 * note), and WHICH signers were waived, as a first-class audited event
 * (`signoff_overridden`). It never fabricates a signature: the waived
 * signers stay un-signed on the record; the override is the honest,
 * attributable act of an authorized human deciding to proceed anyway.
 *
 * Preconditions (all enforced): caller is owner/admin; the proposal is in
 * `all` mode and still in flight (sent/viewed); at least one signer has
 * accepted (there must be a real acceptance to anchor the total) and at
 * least one has NOT (otherwise it would have completed on its own).
 */
export async function overrideProposalSignoffAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase, userId }) => {
      const proposalId = formData.get("id") as string;
      if (!proposalId) throw new Error("Missing proposal id.");
      const note = ((formData.get("note") as string) ?? "").trim();
      if (note.length < OVERRIDE_NOTE_MIN) {
        throw AppError.refusal(
          "An override needs a short reason for the record.",
        );
      }

      const { data: proposal } = await supabase
        .from("proposals")
        .select("id, team_id, status, signing_mode")
        .eq("id", proposalId)
        .single();
      if (!proposal) throw new Error("Proposal not found.");
      await requireTeamAdmin(proposal.team_id as string);

      if ((proposal.signing_mode as string | null) !== "all") {
        throw AppError.refusal(
          "Override only applies to proposals that require every signer.",
        );
      }
      const status = (proposal.status as string) ?? "draft";
      if (status !== "sent" && status !== "viewed") {
        throw AppError.refusal(
          "Only an in-flight proposal awaiting signatures can be overridden.",
        );
      }

      // The roster and every decision so far. We need: at least one accepted
      // (to anchor the total + prove there's something to stand on) and at
      // least one not-yet-signed (otherwise the deal would already be
      // accepted and there's nothing to override).
      const roster = await loadProposalRoster(supabase, proposalId);
      const { data: acceptanceRows } = await supabase
        .from("proposal_acceptances")
        .select("signer_id, decision, accepted_total, signer_name")
        .eq("proposal_id", proposalId)
        .order("occurred_at", { ascending: true });
      const acceptances = (acceptanceRows ?? []) as Array<{
        signer_id: string | null;
        decision: string;
        accepted_total: number | null;
        signer_name: string | null;
      }>;
      const accepted = acceptances.filter((a) => a.decision === "accepted");
      if (accepted.length === 0) {
        throw AppError.refusal(
          "No one has signed yet — there's nothing to override to. Decline or resend instead.",
        );
      }
      if (roster.length > 0 && accepted.length >= roster.length) {
        throw AppError.refusal(
          "Every signer has already signed; no override is needed.",
        );
      }

      // Anchor the total on the PRIMARY's bound acceptance (roster sort_order
      // 0), matching the sign-service completion rule — every 'all'-mode
      // acceptance carries the same bound subset, so the primary's total is
      // the authorized amount. Fall back to the first acceptance if the
      // primary's isn't found (defensive; shouldn't happen post-send-lock).
      const primaryId = roster[0]?.id ?? null;
      const anchor =
        accepted.find((a) => a.signer_id === primaryId) ?? accepted[0]!;
      const acceptedTotal = Number(anchor.accepted_total ?? 0);

      const signedIds = new Set(
        accepted.map((a) => a.signer_id).filter((v): v is string => v != null),
      );
      const waivedSigners = roster
        .filter((r) => !signedIds.has(r.id))
        .map((r) => r.name);

      assertSupabaseOk(
        await supabase
          .from("proposals")
          .update({ status: "accepted", accepted_total: acceptedTotal })
          .eq("id", proposalId),
      );

      const admin = createAdminClient();
      // The holdout's sign link is now moot — revoke any outstanding tokens
      // so a late click can't mint a competing decision.
      await admin
        .from("proposal_access_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("proposal_id", proposalId)
        .is("revoked_at", null);
      await admin.from("proposal_events").insert({
        proposal_id: proposalId,
        team_id: proposal.team_id as string,
        event_type: "signoff_overridden",
        actor_user_id: userId,
        actor_label: null,
        metadata: {
          note,
          waived_signers: waivedSigners,
          accepted_total: acceptedTotal,
        },
      });

      revalidatePath("/proposals");
      revalidatePath(`/proposals/${proposalId}`);
    },
    "overrideProposalSignoffAction",
  ) as unknown as void;
}
