import { z } from "zod";
import { addressSchema } from "./address";

export const teamSettingsSchema = z.object({
  business_name: z.string().max(200).optional().or(z.literal("")),
  business_email: z.string().email("Invalid email").optional().or(z.literal("")),
  business_address: addressSchema.optional(),
  business_phone: z.string().max(30).optional().or(z.literal("")),
  default_rate: z
    .number()
    .min(0, "Rate must be positive")
    .max(10000)
    .optional()
    .default(0),
  invoice_prefix: z.string().min(1).max(10).optional().default("INV"),
  invoice_next_num: z.number().int().min(1).optional().default(1),
  tax_rate: z
    .number()
    .min(0, "Tax rate must be positive")
    .max(100, "Tax rate cannot exceed 100%")
    .optional()
    .default(0),
  // Branding — paired DB CHECKs enforce length caps + hex format.
  // Empty strings come from optional form inputs; treat them as null
  // server-side so we don't write empty rows to the DB.
  wordmark_primary: z.string().max(50).optional().or(z.literal("")),
  wordmark_secondary: z.string().max(50).optional().or(z.literal("")),
  brand_color: z
    .string()
    .regex(
      /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/,
      "Use a hex color like #7BAE5F",
    )
    .optional()
    .or(z.literal("")),
  team_id: z.string().uuid("Invalid team"),
});

export type TeamSettingsInput = z.infer<typeof teamSettingsSchema>;
