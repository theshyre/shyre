import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { sendProposalEmail } from "@/lib/messaging/send-proposal";
import {
  sha256Hex,
  generateOtpCode,
  hashOtp,
  digestsEqual,
  OTP_TTL_MINUTES,
  MAX_OTP_ATTEMPTS,
} from "./tokens";
import { roundMoney } from "./line-items";
import { isValidProposalStatusTransition } from "./status";

/**
 * The public sign-off service (SAL-036). Every function takes the RAW token
 * from the URL, resolves it by sha256 hash via the service-role admin client
 * (no anon RLS grants exist), and enforces expiry / revocation / consumption /
 * OTP state server-side. The browser is never trusted with anything but the
 * token string and the fields in the returned bundle.
 */

export interface SignBundleItemPhase {
  title: string;
  fixedPrice: number;
}

export interface SignBundleItem {
  id: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string | null;
  description: string | null;
  whyItMatters: string | null;
  outOfScope: string | null;
  definitionOfDone: string | null;
  fixedPrice: number;
  isCapped: boolean;
  phases: SignBundleItemPhase[];
}

export interface SignBundle {
  proposal: {
    proposalNumber: string;
    title: string;
    status: string;
    issuedDate: string | null;
    validUntil: string | null;
    paymentTermsLabel: string | null;
    depositType: "none" | "percent" | "amount";
    depositValue: number | null;
    warrantyDays: number | null;
    termsNotes: string | null;
    currency: string;
    /** Set once a decision is recorded (accepted subsets only). */
    acceptedTotal: number | null;
  };
  items: SignBundleItem[];
  businessName: string | null;
  /** Branding for the sign-page header (SAL-041 — a public URL rendered as a
   *  plain <img>). Logo wins; else the two-tone wordmark in the brand color. */
  businessLogoUrl: string | null;
  brandColor: string | null;
  wordmarkPrimary: string | null;
  wordmarkSecondary: string | null;
  customerName: string | null;
  /** Customer co-brand (SAL-041 public URL) — shown next to the team's brand. */
  customerLogoUrl: string | null;
  customerAccentColor: string | null;
  signerEmail: string;
  /** Multi-signer context for THIS signer's link. `first` = any one signer
   *  binds; `all` = every rostered signer must sign the same subset. */
  signingMode: "first" | "all";
  /** In 'all' mode, once the primary has authorized, co-signers are BOUND to
   *  this subset (rendered read-only, pre-selected). Null when not bound. */
  boundSelectedIds: string[] | null;
  /** A co-signer opened their link before the primary authorized the scope —
   *  they can't sign yet. */
  awaitingPrimary: boolean;
  /** Optional proposal-level intro/summary (markdown), above the items. */
  overviewMarkdown: string | null;
  /** Sign-time state driving the page's flow. */
  otpVerified: boolean;
  otpPending: boolean;
  decided: boolean;
  /** The OFFER's validity window has passed (`valid_until` < today). The
   *  page blocks acceptance but still allows a decline for the record. */
  offerExpired: boolean;
}

export type SignFailReason =
  | "not_found"
  | "expired"
  | "revoked"
  | "consumed"
  | "otp_required"
  | "otp_expired"
  | "otp_invalid"
  | "otp_locked"
  | "otp_cooldown"
  | "invalid_state"
  | "invalid_selection"
  | "offer_expired"
  | "awaiting_primary"
  | "email_failed";

/** DATE-string comparison in UTC: has the offer's validity window passed?
 *  `valid_until` is inclusive — the offer is good THROUGH that day. */
export function offerExpired(validUntil: string | null): boolean {
  if (!validUntil) return false;
  return validUntil < new Date().toISOString().slice(0, 10);
}

export type SignResult<T> = { ok: true; value: T } | { ok: false; reason: SignFailReason };

interface TokenRow {
  id: string;
  proposal_id: string;
  team_id: string;
  /** Which roster signer this link is for; NULL on the single-signer path. */
  signer_id: string | null;
  signer_email: string;
  signer_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  first_viewed_at: string | null;
  otp_code_hash: string | null;
  otp_expires_at: string | null;
  otp_attempts: number;
  otp_verified_at: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

async function findValidToken(
  admin: Admin,
  rawToken: string,
): Promise<SignResult<TokenRow>> {
  const { data } = await admin
    .from("proposal_access_tokens")
    .select("*")
    .eq("token_hash", sha256Hex(rawToken))
    .single();
  const token = data as TokenRow | null;
  if (!token) return { ok: false, reason: "not_found" };
  if (token.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, value: token };
}

async function insertEvent(
  admin: Admin,
  token: TokenRow,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("proposal_events").insert({
    proposal_id: token.proposal_id,
    team_id: token.team_id,
    event_type: eventType,
    actor_user_id: null,
    actor_label: `${token.signer_name ?? token.signer_email} (signer)`,
    metadata,
  });
  if (error) {
    // The audit log must not silently drop events — surface to /admin/errors.
    logError(new Error(`proposal_events insert failed: ${error.message}`), {
      teamId: token.team_id,
      action: "signService.insertEvent",
    });
  }
}

interface LineItemRow {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  description: string | null;
  why_it_matters: string | null;
  out_of_scope: string | null;
  definition_of_done: string | null;
  fixed_price: number | string;
  is_capped: boolean;
}

async function loadItems(
  admin: Admin,
  proposalId: string,
): Promise<SignBundleItem[]> {
  const { data } = await admin
    .from("proposal_line_items")
    .select(
      "id, parent_line_item_id, sort_order, title, summary, body_markdown, description, why_it_matters, out_of_scope, definition_of_done, fixed_price, is_capped",
    )
    .eq("proposal_id", proposalId)
    .order("sort_order");
  const rows = (data ?? []) as LineItemRow[];
  return rows
    .filter((r) => r.parent_line_item_id === null)
    .map((parent) => ({
      id: parent.id,
      title: parent.title,
      summary: parent.summary ?? null,
      bodyMarkdown: parent.body_markdown,
      description: parent.description,
      whyItMatters: parent.why_it_matters,
      outOfScope: parent.out_of_scope,
      definitionOfDone: parent.definition_of_done,
      fixedPrice: Number(parent.fixed_price),
      isCapped: parent.is_capped,
      phases: rows
        .filter((r) => r.parent_line_item_id === parent.id)
        .map((phase) => ({
          title: phase.title,
          fixedPrice: Number(phase.fixed_price),
        })),
    }));
}

/**
 * Resolve a sign link: validate the token, record the first view (event +
 * `sent → viewed` status flip), and return the client-safe bundle.
 */
export async function loadSignBundle(
  rawToken: string,
): Promise<SignResult<SignBundle>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;

  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, team_id, proposal_number, title, status, issued_date, valid_until, payment_terms_label, deposit_type, deposit_value, warranty_days, terms_notes, currency, accepted_total, signing_mode, overview_markdown, customers(name, accent_color, logo_url)",
    )
    .eq("id", token.proposal_id)
    .single();
  if (!proposal) return { ok: false, reason: "not_found" };

  // First open: stamp the token, log the event, flip sent → viewed. Later
  // opens are not re-logged (the "viewed" fact is already on the record).
  if (!token.first_viewed_at) {
    await admin
      .from("proposal_access_tokens")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("id", token.id);
    await insertEvent(admin, token, "viewed");
    if (
      proposal.status === "sent" &&
      isValidProposalStatusTransition("sent", "viewed")
    ) {
      await admin
        .from("proposals")
        .update({ status: "viewed" })
        .eq("id", token.proposal_id);
    }
  }

  const { data: settings } = await admin
    .from("team_settings")
    .select(
      "business_name, logo_url, brand_color, wordmark_primary, wordmark_secondary",
    )
    .eq("team_id", token.team_id)
    .single();
  type CustomerBrand = {
    name: string;
    accent_color: string | null;
    logo_url: string | null;
  };
  const customer = Array.isArray(proposal.customers)
    ? ((proposal.customers[0] ?? null) as CustomerBrand | null)
    : (proposal.customers as CustomerBrand | null);

  const items = await loadItems(admin, token.proposal_id);

  const otpPending =
    !!token.otp_code_hash &&
    !!token.otp_expires_at &&
    new Date(token.otp_expires_at).getTime() > Date.now() &&
    token.otp_attempts < MAX_OTP_ATTEMPTS;

  // Multi-signer context for this signer's link (mirrors recordSignDecision's
  // binding rule, so the page shows what the server will enforce).
  const signingMode = ((proposal.signing_mode as string) ?? "first") as
    | "first"
    | "all";
  let boundSelectedIds: string[] | null = null;
  let awaitingPrimary = false;
  if (signingMode === "all" && token.signer_id !== null) {
    const { data: rosterRows } = await admin
      .from("proposal_signers")
      .select("id")
      .eq("proposal_id", token.proposal_id)
      .order("sort_order")
      .limit(1);
    const isPrimary = token.signer_id === (rosterRows?.[0]?.id ?? null);
    const { data: priorRows } = await admin
      .from("proposal_acceptances")
      .select("selected_line_item_ids")
      .eq("proposal_id", token.proposal_id)
      .eq("decision", "accepted")
      .order("occurred_at", { ascending: true })
      .limit(1);
    const prior = priorRows?.[0];
    if (prior) {
      boundSelectedIds = [
        ...new Set((prior.selected_line_item_ids as string[]) ?? []),
      ];
    } else if (!isPrimary) {
      awaitingPrimary = true;
    }
  }

  return {
    ok: true,
    value: {
      proposal: {
        proposalNumber: proposal.proposal_number as string,
        title: proposal.title as string,
        status: (proposal.status as string) ?? "sent",
        issuedDate: (proposal.issued_date as string | null) ?? null,
        validUntil: (proposal.valid_until as string | null) ?? null,
        paymentTermsLabel:
          (proposal.payment_terms_label as string | null) ?? null,
        depositType:
          (proposal.deposit_type as "none" | "percent" | "amount") ?? "none",
        depositValue:
          proposal.deposit_value != null
            ? Number(proposal.deposit_value)
            : null,
        warrantyDays: (proposal.warranty_days as number | null) ?? null,
        termsNotes: (proposal.terms_notes as string | null) ?? null,
        currency: (proposal.currency as string) ?? "USD",
        acceptedTotal:
          proposal.accepted_total != null
            ? Number(proposal.accepted_total)
            : null,
      },
      items,
      businessName: (settings?.business_name as string | null) ?? null,
      businessLogoUrl: (settings?.logo_url as string | null) ?? null,
      brandColor: (settings?.brand_color as string | null) ?? null,
      wordmarkPrimary: (settings?.wordmark_primary as string | null) ?? null,
      wordmarkSecondary: (settings?.wordmark_secondary as string | null) ?? null,
      customerName: customer?.name ?? null,
      customerLogoUrl: customer?.logo_url ?? null,
      customerAccentColor: customer?.accent_color ?? null,
      signerEmail: token.signer_email,
      otpVerified: !!token.otp_verified_at,
      otpPending,
      decided: !!token.consumed_at,
      offerExpired: offerExpired(
        (proposal.valid_until as string | null) ?? null,
      ),
      signingMode,
      boundSelectedIds,
      awaitingPrimary,
      overviewMarkdown:
        (proposal.overview_markdown as string | null) ?? null,
    },
  };
}

/** Email a fresh one-time code to the signer. 60s cooldown between issues
 *  (email spam + event noise); each issue resets the attempt budget along
 *  with the code itself. */
export async function issueSignOtp(
  rawToken: string,
): Promise<SignResult<{ sentTo: string }>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;
  if (token.consumed_at) return { ok: false, reason: "consumed" };

  // Cooldown: a still-fresh code issued < 60s ago blocks a re-issue.
  if (token.otp_expires_at) {
    const issuedAt =
      new Date(token.otp_expires_at).getTime() - OTP_TTL_MINUTES * 60_000;
    if (Date.now() - issuedAt < 60_000) {
      return { ok: false, reason: "otp_cooldown" };
    }
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
  await admin
    .from("proposal_access_tokens")
    .update({
      otp_code_hash: hashOtp(token.id, code),
      otp_expires_at: expiresAt.toISOString(),
      otp_attempts: 0,
      otp_verified_at: null,
    })
    .eq("id", token.id);

  try {
    await sendProposalEmail(admin, {
      teamId: token.team_id,
      userId: null,
      proposalId: token.proposal_id,
      kind: "proposal_otp",
      toEmail: token.signer_email,
      // Code stays OUT of the subject — subjects surface in lock-screen
      // previews and mail-server logs without the mail being opened.
      subject: "Your sign-off code",
      bodyHtml: `<p>Your one-time code to sign off on the proposal is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.</p>`,
      bodyText: `Your one-time code to sign off on the proposal is: ${code}\n\nIt expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
    });
  } catch (err) {
    logError(err, {
      teamId: token.team_id,
      action: "signService.issueSignOtp",
    });
    return { ok: false, reason: "email_failed" };
  }

  await insertEvent(admin, token, "otp_sent");
  return { ok: true, value: { sentTo: token.signer_email } };
}

/** Verify an entered code. Attempts are counted BEFORE comparison so a
 *  storm of guesses burns the budget even on racy parallel submits; the
 *  budget locks the current code, and only a fresh issue resets it. */
export async function verifySignOtp(
  rawToken: string,
  code: string,
): Promise<SignResult<{ verified: true }>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;
  if (token.consumed_at) return { ok: false, reason: "consumed" };
  if (!token.otp_code_hash || !token.otp_expires_at) {
    return { ok: false, reason: "otp_required" };
  }
  if (new Date(token.otp_expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "otp_expired" };
  }

  // ATOMIC conditional increment (SAL-037): one UPDATE that only fires while
  // under budget and returns the new count — parallel guesses each consume a
  // real attempt instead of racing a stale read. NULL = locked.
  const { data: attempts } = await admin.rpc("proposal_otp_attempt", {
    p_token_id: token.id,
  });
  if (attempts == null) {
    return { ok: false, reason: "otp_locked" };
  }

  if (!digestsEqual(hashOtp(token.id, code), token.otp_code_hash)) {
    // Every failed attempt is evidence — a brute-force burst must be visible
    // in the activity trail, not just the final lockout.
    await insertEvent(admin, token, "otp_failed", { attempts });
    return {
      ok: false,
      reason:
        (attempts as number) >= MAX_OTP_ATTEMPTS ? "otp_locked" : "otp_invalid",
    };
  }

  await admin
    .from("proposal_access_tokens")
    .update({ otp_verified_at: new Date().toISOString() })
    .eq("id", token.id);
  await insertEvent(admin, token, "otp_verified");
  return { ok: true, value: { verified: true } };
}

export interface SignDecisionInput {
  decision: "accepted" | "declined";
  signerName: string;
  signerTitle: string | null;
  signatureTyped: string | null;
  selectedLineItemIds: string[];
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Record the signer's decision. Requires a verified OTP. The accepted total
 * is computed SERVER-SIDE from the selected top-level items — the client's
 * arithmetic is never trusted — and the whole document is snapshotted with a
 * sha256 so "what exactly was accepted" survives any later change.
 */
export async function recordSignDecision(
  rawToken: string,
  input: SignDecisionInput,
): Promise<SignResult<{ decision: "accepted" | "declined" }>> {
  const admin = createAdminClient();
  const tokenResult = await findValidToken(admin, rawToken);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;
  if (token.consumed_at) return { ok: false, reason: "consumed" };
  if (!token.otp_verified_at) return { ok: false, reason: "otp_required" };

  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, status, proposal_number, title, payment_terms_label, deposit_type, deposit_value, warranty_days, terms_notes, currency, valid_until, signing_mode",
    )
    .eq("id", token.proposal_id)
    .single();
  if (!proposal) return { ok: false, reason: "not_found" };
  if (
    !isValidProposalStatusTransition(
      (proposal.status as string) ?? "",
      input.decision,
    )
  ) {
    return { ok: false, reason: "invalid_state" };
  }

  // Multi-signer 'all' mode: every signer must authorize the SAME subset, so
  // the PRIMARY (roster sort_order 0) signs first and their accepted subset
  // BINDS every co-signer. This enforces ordering (co-signers are blocked
  // until the primary decides) — which also closes the race where two
  // "first" signers could otherwise bind divergent subsets.
  const isAll =
    (proposal.signing_mode as string) === "all" && token.signer_id !== null;
  let boundSubset: string[] | null = null;
  if (isAll) {
    const { data: rosterRows } = await admin
      .from("proposal_signers")
      .select("id")
      .eq("proposal_id", token.proposal_id)
      .order("sort_order")
      .limit(1);
    const primaryId = (rosterRows?.[0]?.id as string | undefined) ?? null;
    const isPrimary = token.signer_id === primaryId;

    const { data: priorRows } = await admin
      .from("proposal_acceptances")
      .select("selected_line_item_ids")
      .eq("proposal_id", token.proposal_id)
      .eq("decision", "accepted")
      .order("occurred_at", { ascending: true })
      .limit(1);
    const prior = priorRows?.[0];
    if (prior) {
      boundSubset = [
        ...new Set((prior.selected_line_item_ids as string[]) ?? []),
      ];
    } else if (!isPrimary && input.decision === "accepted") {
      // No binding subset yet and this isn't the primary — the primary must
      // authorize the scope first.
      return { ok: false, reason: "awaiting_primary" };
    }
  }

  // An expired OFFER can no longer be accepted — but a decline is still a
  // recordable business outcome.
  if (
    input.decision === "accepted" &&
    offerExpired((proposal.valid_until as string | null) ?? null)
  ) {
    return { ok: false, reason: "offer_expired" };
  }

  const items = await loadItems(admin, token.proposal_id);
  const itemIds = new Set(items.map((i) => i.id));
  // A co-signer in 'all' mode is BOUND to the primary's subset — their own
  // selection is ignored so every signature covers one identical content hash.
  const selected =
    boundSubset ?? [...new Set(input.selectedLineItemIds)];

  let acceptedTotal: number | null = null;
  if (input.decision === "accepted") {
    if (selected.length === 0 || selected.some((id) => !itemIds.has(id))) {
      return { ok: false, reason: "invalid_selection" };
    }
    acceptedTotal = roundMoney(
      items
        .filter((i) => selected.includes(i.id))
        .reduce((sum, i) => sum + i.fixedPrice, 0),
    );
  }

  // Freeze the tax rate in force at signing. A signed fixed-price deal is a
  // promise about the client's total — if we applied the team-default rate
  // whenever the invoice is later generated, a rate change between signing
  // and billing would silently move the number the client authorized. The
  // rate snapshot rides on the acceptance and is what the invoice bills at.
  let taxRateSnapshot: number | null = null;
  if (input.decision === "accepted") {
    const { data: settings } = await admin
      .from("team_settings")
      .select("tax_rate")
      .eq("team_id", token.team_id)
      .maybeSingle();
    taxRateSnapshot = settings?.tax_rate != null ? Number(settings.tax_rate) : 0;
  }

  // Frozen document snapshot — stable key order so the sha256 is
  // reproducible from the stored JSON.
  const snapshot = {
    proposalNumber: proposal.proposal_number as string,
    title: proposal.title as string,
    currency: (proposal.currency as string) ?? "USD",
    paymentTermsLabel: (proposal.payment_terms_label as string | null) ?? null,
    depositType: (proposal.deposit_type as string) ?? "none",
    depositValue:
      proposal.deposit_value != null ? Number(proposal.deposit_value) : null,
    warrantyDays: (proposal.warranty_days as number | null) ?? null,
    termsNotes: (proposal.terms_notes as string | null) ?? null,
    decision: input.decision,
    acceptedTotal,
    taxRate: taxRateSnapshot,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      fixedPrice: item.fixedPrice,
      isCapped: item.isCapped,
      selected: selected.includes(item.id),
      phases: item.phases,
    })),
  };
  const snapshotJson = JSON.stringify(snapshot);

  // Consume the token FIRST via a conditional update (SAL-038): only one of
  // any concurrent submits wins the `consumed_at IS NULL` predicate, so the
  // "one decision per proposal" guarantee holds under parallelism. The
  // unique index on proposal_acceptances(proposal_id) is the DB backstop.
  const { data: consumedRows } = await admin
    .from("proposal_access_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", token.id)
    .is("consumed_at", null)
    .select("id");
  if (!consumedRows || consumedRows.length === 0) {
    return { ok: false, reason: "consumed" };
  }

  const { error: acceptError } = await admin
    .from("proposal_acceptances")
    .insert({
      proposal_id: token.proposal_id,
      team_id: token.team_id,
      signer_id: token.signer_id,
      decision: input.decision,
      signer_name: input.signerName,
      signer_title: input.signerTitle,
      signer_email: token.signer_email,
      signature_typed: input.signatureTyped,
      selected_line_item_ids: input.decision === "accepted" ? selected : [],
      content_snapshot: snapshot,
      content_sha256: sha256Hex(snapshotJson),
      accepted_total: acceptedTotal,
      tax_rate: taxRateSnapshot,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      otp_verified_at: token.otp_verified_at,
    });
  if (acceptError) {
    logError(new Error(`acceptance insert failed: ${acceptError.message}`), {
      teamId: token.team_id,
      action: "signService.recordSignDecision",
    });
    // Roll back the consume so the signer can retry — better a retryable
    // token than a consumed link with no decision record.
    await admin
      .from("proposal_access_tokens")
      .update({ consumed_at: null })
      .eq("id", token.id);
    return { ok: false, reason: "invalid_state" };
  }

  // Status flip. A decline by anyone kills the deal immediately. An accept
  // decides it right away in single-signer / 'first' mode; in 'all' mode it
  // flips to accepted only once EVERY rostered signer has accepted (the shared
  // bound subset means every acceptance carries the same total).
  if (input.decision === "declined") {
    await admin
      .from("proposals")
      .update({ status: "declined" })
      .eq("id", token.proposal_id);
  } else if (!isAll) {
    await admin
      .from("proposals")
      .update({ status: "accepted", accepted_total: acceptedTotal })
      .eq("id", token.proposal_id);
  } else {
    const { count: signerCount } = await admin
      .from("proposal_signers")
      .select("id", { count: "exact", head: true })
      .eq("proposal_id", token.proposal_id);
    const { count: acceptedCount } = await admin
      .from("proposal_acceptances")
      .select("id", { count: "exact", head: true })
      .eq("proposal_id", token.proposal_id)
      .eq("decision", "accepted");
    if (
      signerCount != null &&
      acceptedCount != null &&
      acceptedCount >= signerCount
    ) {
      await admin
        .from("proposals")
        .update({ status: "accepted", accepted_total: acceptedTotal })
        .eq("id", token.proposal_id);
    }
    // Otherwise more signatures are pending — status stays sent/viewed.
  }
  await insertEvent(admin, token, input.decision, {
    accepted_total: acceptedTotal,
    selected_count: input.decision === "accepted" ? selected.length : 0,
  });

  return { ok: true, value: { decision: input.decision } };
}
