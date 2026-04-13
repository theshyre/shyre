import { z } from "zod";
import { addressSchema } from "./address";

export const clientSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  address: addressSchema.optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
  default_rate: z
    .number()
    .min(0, "Rate must be positive")
    .max(10000, "Rate seems too high")
    .optional()
    .nullable(),
  organization_id: z.string().uuid("Invalid organization"),
});

export type ClientInput = z.infer<typeof clientSchema>;
