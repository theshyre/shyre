/**
 * Allow-lists for proposals.* enum-shaped columns. Mirrored by CHECK
 * constraints in `20260716130000_proposals_p1_model.sql`; parity is enforced
 * by `src/__tests__/db-parity.test.ts`.
 *
 * Plain module (no `"use server"`) so it can be imported by client components,
 * server actions, and the parity test alike. Widening a set here without
 * widening the CHECK in the same PR trips the parity test.
 */

/**
 * Proposal lifecycle statuses, in display order. Forward-only graph
 * (draft → sent → viewed → accepted|declined → converted), with `superseded`
 * as the terminal state a version enters when a newer version replaces it.
 * The transition rules live in `proposal-status.ts` (P2); this is just the
 * value set the DB CHECK mirrors (table-scoped to `proposals`).
 */
export const PROPOSAL_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "converted",
  "superseded",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ALLOWED_PROPOSAL_STATUSES = new Set<string>(PROPOSAL_STATUSES);

/**
 * A proposal is editable only while `draft`. Once sent it's frozen; changes
 * go through a new version (the invoice freeze-and-reissue doctrine). The
 * DB-level send-lock lands in P4; this predicate is the action-layer guard.
 */
export function isProposalEditable(status: string | null | undefined): boolean {
  return status === "draft";
}

/**
 * A proposal is deletable while `draft` (never sent — pure staging) or
 * `superseded` (a replaced version; the current version lives on, and the
 * `supersedes_proposal_id` FK is ON DELETE SET NULL so removing a link in
 * the chain is safe). Everything else — sent / viewed / accepted / declined
 * / converted — is part of the audit record and is never deletable; those
 * are voided or reissued, not erased. Enforced in `deleteProposalAction`.
 */
export function isProposalDeletable(
  status: string | null | undefined,
): boolean {
  return status === "draft" || status === "superseded";
}

/** Terminal statuses — no further transitions. */
export const TERMINAL_PROPOSAL_STATUSES = new Set<string>([
  "declined",
  "converted",
  "superseded",
]);

/**
 * Deposit modeling on the terms block. `none` = no deposit; `percent` =
 * `deposit_value`% of the accepted total; `amount` = a flat `deposit_value`.
 * v1 records the deposit as a term only — generating a deposit invoice is
 * deferred.
 */
export const DEPOSIT_TYPES = ["none", "percent", "amount"] as const;

export type DepositType = (typeof DEPOSIT_TYPES)[number];

export const ALLOWED_DEPOSIT_TYPES = new Set<string>(DEPOSIT_TYPES);

/**
 * Forward lifecycle events (`proposal_events.event_type`). Signer-side events
 * (viewed / otp_* / accepted / declined) carry a NULL actor_user_id — the
 * client is not a Shyre user. Mirrored by the CHECK in the P2 migration.
 */
export const PROPOSAL_EVENT_TYPES = [
  "created",
  "sent",
  "viewed",
  "otp_sent",
  "otp_verified",
  "otp_failed",
  "accepted",
  "declined",
  "countersigned",
  "converted",
  "superseded",
  "link_resent",
  "signoff_overridden",
] as const;

export type ProposalEventType = (typeof PROPOSAL_EVENT_TYPES)[number];

export const ALLOWED_PROPOSAL_EVENT_TYPES = new Set<string>(
  PROPOSAL_EVENT_TYPES,
);

/** `proposal_acceptances.decision` — the two recordable outcomes. */
export const ACCEPTANCE_DECISIONS = ["accepted", "declined"] as const;

export type AcceptanceDecision = (typeof ACCEPTANCE_DECISIONS)[number];

export const ALLOWED_ACCEPTANCE_DECISIONS = new Set<string>(
  ACCEPTANCE_DECISIONS,
);

/**
 * `proposals.signing_mode` — how many rostered signers must authorize:
 * `first` = any one signer's authorization is binding (the single-signer
 * default); `all` = every signer must counter-sign the SAME accepted subset.
 * Mirrored by the CHECK in `20260717160000_proposals_multi_signer_schema.sql`.
 */
export const SIGNING_MODES = ["first", "all"] as const;

export type SigningMode = (typeof SIGNING_MODES)[number];

export const ALLOWED_SIGNING_MODES = new Set<string>(SIGNING_MODES);

/**
 * `proposals.sign_theme` — the color theme the CLIENT sees on the public sign
 * page + the internal preview, pinned by the author when drafting (default
 * `light`). A client-facing document should look consistent — like the PDF —
 * not follow each recipient's OS dark/light preference. Limited to the three
 * aesthetic themes; `high-contrast` is a viewer-side a11y setting, not a
 * document brand choice, and `system` is exactly the per-client drift we're
 * pinning away from. Mirrored by the CHECK in
 * `20260717200000_proposals_sign_theme.sql`.
 */
export const SIGN_THEMES = ["light", "dark", "warm"] as const;

export type SignTheme = (typeof SIGN_THEMES)[number];

export const ALLOWED_SIGN_THEMES = new Set<string>(SIGN_THEMES);

/** Fallback when the column is absent (pre-migration) or holds a stale value. */
export const DEFAULT_SIGN_THEME: SignTheme = "light";

/** Coerce a stored/loaded `sign_theme` to a known value, defaulting to light —
 *  a bad or absent value must never break the client-facing render. */
export function resolveSignTheme(value: unknown): SignTheme {
  return typeof value === "string" && ALLOWED_SIGN_THEMES.has(value)
    ? (value as SignTheme)
    : DEFAULT_SIGN_THEME;
}

/**
 * `proposal_line_items.pricing_type` — WHAT KIND of pricing a line item is:
 *   fixed_bid       — firm price, client pays it regardless of hours
 *   estimate_nte    — hourly, capped at a not-to-exceed amount ("up to $X")
 *   estimate_range  — hourly, a communicated low–high band (guidance)
 *   estimate_tm     — hourly, no cap (time & materials); estimate is guidance
 *
 * The dollar figure stays in `fixed_price` (the anchor amount, meaning shifts
 * by type). Mirrored by the CHECK in
 * `20260722130000_proposal_line_item_pricing_type.sql`; every existing row is
 * `fixed_bid` (the NOT NULL DEFAULT backfill).
 */
export const PRICING_TYPES = [
  "fixed_bid",
  "estimate_nte",
  "estimate_range",
  "estimate_tm",
] as const;

export type PricingType = (typeof PRICING_TYPES)[number];

export const ALLOWED_PRICING_TYPES = new Set<string>(PRICING_TYPES);

/** Fallback when the column is absent (pre-migration) or holds a stale value. */
export const DEFAULT_PRICING_TYPE: PricingType = "fixed_bid";

/** Coerce a stored/loaded `pricing_type` to a known value, defaulting to
 *  fixed_bid — a bad or absent value must never break a proposal render. */
export function resolvePricingType(value: unknown): PricingType {
  return typeof value === "string" && ALLOWED_PRICING_TYPES.has(value)
    ? (value as PricingType)
    : DEFAULT_PRICING_TYPE;
}
