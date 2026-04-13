import { z } from "zod";

export const projectSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  client_id: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().or(z.literal("")),
  hourly_rate: z
    .number()
    .min(0, "Rate must be positive")
    .max(10000, "Rate seems too high")
    .optional()
    .nullable(),
  budget_hours: z
    .number()
    .min(0, "Budget must be positive")
    .optional()
    .nullable(),
  github_repo: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, "Format: owner/repo")
    .optional()
    .or(z.literal("")),
  organization_id: z.string().uuid("Invalid organization"),
});

export type ProjectInput = z.infer<typeof projectSchema>;
