import { z } from "zod";

import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { startTimer } from "@/lib/integrations/service";

/**
 * POST /api/v1/timer/start — start a timer for the token's user
 * (SAL-051). 409 whenever ANY timer is already running: an agent start
 * never displaces the human's timer. Prefer POST /api/v1/entries for
 * completed work.
 */
const bodySchema = z
  .object({
    project_id: z.uuid(),
    description: z.string().max(2000).optional(),
    agent_label: z.string().min(1).max(64).optional(),
    session_ref: z.string().min(1).max(256).optional(),
    idempotency_key: z.string().min(1).max(128).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return runIntegrationRoute(request, {
    action: "api.v1.timer.start",
    bodySchema,
    invoke: (tokenHash, body) =>
      startTimer(tokenHash, {
        projectId: body.project_id,
        description: body.description,
        agentLabel: body.agent_label,
        sessionRef: body.session_ref,
        idempotencyKey: body.idempotency_key,
      }),
  });
}
