import { z } from "zod";
import {
  validateProposalItems,
  MAX_MONEY,
} from "@/lib/proposals/line-items";
import { DEPOSIT_TYPES } from "@/app/(dashboard)/proposals/allow-lists";

const ymd = /^\d{4}-\d{2}-\d{2}$/;

const phaseSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(2000).optional().nullable(),
  fixedPrice: z.number(),
});

const itemSchema = z.object({
  title: z.string().max(200),
  // Rich markdown body — replaces the legacy why/scope/DoD prose. The legacy
  // scalar fields stay optional for backward compatibility (older rows render
  // from them until re-saved).
  bodyMarkdown: z.string().max(20000).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  whyItMatters: z.string().max(5000).optional().nullable(),
  outOfScope: z.string().max(5000).optional().nullable(),
  definitionOfDone: z.string().max(5000).optional().nullable(),
  fixedPrice: z.number(),
  isCapped: z.boolean().optional(),
  phases: z.array(phaseSchema).max(20).optional(),
});

/**
 * The scalar shape shared by the strict and draft schemas. Bounds that guard
 * against persisting *corrupt* data (over-long strings, out-of-range numbers,
 * malformed dates) live here so BOTH paths enforce them; the completeness
 * rules that only matter when a proposal goes out (title present, ≥1 item,
 * phase sums, deposit coupling) are layered on top by the strict schema alone.
 *
 * `title` is lenient here (a work-in-progress draft may not be named yet); the
 * strict schema tightens it to `min(1)`.
 */
const proposalFields = {
  team_id: z.string().uuid("Invalid team"),
  customer_id: z.string().uuid("Invalid customer"),
  signer_contact_id: z.string().uuid().optional().nullable(),
  // Multi-signer roster: ordered contact ids (entry 0 is the primary signer,
  // mirrored onto signer_contact_id). Empty = the single-signer default.
  signers: z.array(z.string().uuid()).max(10).optional().default([]),
  signing_mode: z.enum(["first", "all"]).optional().default("first"),
  title: z.string().max(200).optional().nullable(),
  issued_date: z.string().regex(ymd, "Invalid date").optional().nullable(),
  valid_until: z.string().regex(ymd, "Invalid date").optional().nullable(),
  payment_terms_days: z.number().int().min(0).max(365).optional().nullable(),
  deposit_type: z.enum(DEPOSIT_TYPES).default("none"),
  deposit_value: z.number().min(0).max(MAX_MONEY).optional().nullable(),
  warranty_days: z.number().int().min(0).max(3650).optional().nullable(),
  terms_notes: z.string().max(10000).optional().nullable(),
  // Optional proposal-level intro/summary (markdown), shown above the items.
  overview_markdown: z.string().max(20000).optional().nullable(),
  items: z.array(itemSchema).max(50),
} as const;

/**
 * Draft (save-as-you-go) schema. Persists a work-in-progress proposal with
 * whatever the author has so far — no title, no items, mismatched phase sums
 * are all fine. Only the corruption bounds in `proposalFields` apply; the
 * completeness gate is deferred to send time (`proposalSendReadiness` at the
 * action layer, the phase-sum-on-send DB trigger as backstop).
 */
export const proposalDraftSchema = z.object(proposalFields);
export type ProposalDraftInput = z.infer<typeof proposalDraftSchema>;

/**
 * Server-boundary schema for a "ready to send" proposal. Adds the completeness
 * rules on top of the draft shape: a required title plus the cross-field money
 * rules (phase sums, price bounds, ≥1 item) delegated to `validateProposalItems`
 * via superRefine, so the form preview and the boundary enforce the same logic.
 */
export const proposalSchema = z
  .object({
    ...proposalFields,
    title: z.string().min(1, "Title is required").max(200),
  })
  .superRefine((val, ctx) => {
    for (const issue of validateProposalItems(val.items)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path.split("."),
        message: issue.key,
        params: issue.params,
      });
    }
    // Deposit coupling: a percent/amount deposit needs a value; percent is
    // bounded to 100. `none` ignores any stale value (form keeps state).
    if (val.deposit_type !== "none") {
      if (val.deposit_value == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deposit_value"],
          message: "depositValueRequired",
        });
      } else if (val.deposit_type === "percent" && val.deposit_value > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deposit_value"],
          message: "depositPercentTooHigh",
        });
      }
    }
    // Validity window can't end before it starts.
    if (
      val.issued_date &&
      val.valid_until &&
      val.valid_until < val.issued_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid_until"],
        message: "validUntilBeforeIssued",
      });
    }
  });

export type ProposalInput = z.infer<typeof proposalSchema>;
