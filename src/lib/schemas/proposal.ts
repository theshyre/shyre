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
  description: z.string().max(5000).optional().nullable(),
  whyItMatters: z.string().max(5000).optional().nullable(),
  outOfScope: z.string().max(5000).optional().nullable(),
  definitionOfDone: z.string().max(5000).optional().nullable(),
  fixedPrice: z.number(),
  isCapped: z.boolean().optional(),
  phases: z.array(phaseSchema).max(20).optional(),
});

/**
 * Server-boundary schema for creating/updating a proposal. Scalar shape lives
 * here; the cross-field money rules (phase sums, price bounds, ≥1 item) are
 * delegated to `validateProposalItems` via superRefine so the form preview and
 * the boundary enforce the same domain logic.
 */
export const proposalSchema = z
  .object({
    team_id: z.string().uuid("Invalid team"),
    customer_id: z.string().uuid("Invalid customer"),
    signer_contact_id: z.string().uuid().optional().nullable(),
    title: z.string().min(1, "Title is required").max(200),
    issued_date: z.string().regex(ymd, "Invalid date").optional().nullable(),
    valid_until: z.string().regex(ymd, "Invalid date").optional().nullable(),
    payment_terms_days: z
      .number()
      .int()
      .min(0)
      .max(365)
      .optional()
      .nullable(),
    deposit_type: z.enum(DEPOSIT_TYPES).default("none"),
    deposit_value: z
      .number()
      .min(0)
      .max(MAX_MONEY)
      .optional()
      .nullable(),
    warranty_days: z.number().int().min(0).max(3650).optional().nullable(),
    terms_notes: z.string().max(10000).optional().nullable(),
    items: z.array(itemSchema).max(50),
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
