import { z } from "zod";

import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { stopTimer } from "@/lib/integrations/service";

/**
 * POST /api/v1/timer/stop — stop the running timer (SAL-051). Without
 * `force` only an agent-started entry is stopped (409 otherwise); an
 * optional description upgrades the entry with the outcome.
 */
const bodySchema = z
  .object({
    description: z.string().max(2000).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return runIntegrationRoute(request, {
    action: "api.v1.timer.stop",
    bodySchema,
    invoke: (tokenHash, body) =>
      stopTimer(tokenHash, {
        description: body.description,
        force: body.force,
      }),
  });
}
