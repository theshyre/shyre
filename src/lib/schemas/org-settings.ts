import { z } from "zod";
import { addressSchema } from "./address";

export const orgSettingsSchema = z.object({
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
  organization_id: z.string().uuid("Invalid organization"),
});

export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>;
