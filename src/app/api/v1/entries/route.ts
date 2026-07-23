import { z } from "zod";

import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { logEntry } from "@/lib/integrations/service";

/**
 * POST /api/v1/entries — log a completed block of work (SAL-051).
 * THE RECOMMENDED PATH for agents: no orphaned timers, no idle
 * inflation, outcome-quality descriptions. The RPC refuses same-project
 * overlap (409), bounds the range (≤24h per entry, ≤5min future skew,
 * ≤1y back as a wrong-year sanity bound), refuses entries dated in a
 * locked accounting period (403 — there is NO fixed backdating window;
 * closed books are the control) and requires a meaningful description.
 */
const bodySchema = z
  .object({
    project_id: z.uuid(),
    start_time: z.iso.datetime({ offset: true }),
    end_time: z.iso.datetime({ offset: true }),
    description: z.string().min(1).max(2000),
    agent_label: z.string().min(1).max(64).optional(),
    session_ref: z.string().min(1).max(256).optional(),
    idempotency_key: z.string().min(1).max(128).optional(),
    billable: z.boolean().optional(),
    category_id: z.uuid().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return runIntegrationRoute(request, {
    action: "api.v1.entries.log",
    bodySchema,
    invoke: (tokenHash, body) =>
      logEntry(tokenHash, {
        projectId: body.project_id,
        startTime: body.start_time,
        endTime: body.end_time,
        description: body.description,
        agentLabel: body.agent_label,
        sessionRef: body.session_ref,
        idempotencyKey: body.idempotency_key,
        billable: body.billable,
        categoryId: body.category_id,
      }),
  });
}
