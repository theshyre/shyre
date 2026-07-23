import { z } from "zod";
import {
  SIGNOFF_DOCUMENT_TYPES,
  SIGNOFF_SIGNING_MODES,
} from "@/lib/sign/allow-lists";

/**
 * Draft schema for authoring a document sign-off. Bounds guard against
 * persisting corrupt data (over-long strings); completeness (a title, ≥1
 * signer, non-empty body) is enforced at SEND time by `signoffSendReadiness`,
 * so a work-in-progress draft can be saved with whatever the author has.
 */

const asSet = (s: Set<string>): [string, ...string[]] =>
  [...s] as [string, ...string[]];

const signerSchema = z.object({
  name: z.string().min(1, "Signer name is required").max(200),
  email: z.string().email("Enter a valid email").max(320),
  roleLabel: z.string().max(120).optional().nullable(),
  orgLabel: z.string().max(200).optional().nullable(),
});
export type SignoffSignerInput = z.infer<typeof signerSchema>;

export const signoffDraftSchema = z.object({
  team_id: z.string().uuid("Invalid team"),
  customer_id: z.string().uuid().optional().nullable(),
  document_type: z.enum(asSet(SIGNOFF_DOCUMENT_TYPES)).default("release_notes"),
  // Lenient for a draft; SEND-readiness requires it.
  title: z.string().max(300).default(""),
  version_label: z.string().max(60).optional().nullable(),
  body_markdown: z.string().max(200000).default(""),
  external_ref: z.string().max(500).optional().nullable(),
  signing_mode: z.enum(asSet(SIGNOFF_SIGNING_MODES)).default("all"),
  sign_theme: z.enum(["light", "dark", "warm"]).default("light"),
  signers: z.array(signerSchema).max(20).default([]),
});
export type SignoffDraftInput = z.infer<typeof signoffDraftSchema>;
