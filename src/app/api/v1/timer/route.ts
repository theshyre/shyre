import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { getTimer } from "@/lib/integrations/service";

/**
 * GET /api/v1/timer — the token user's currently running entry, or
 * `null` when nothing is running (SAL-051).
 */
export async function GET(request: Request): Promise<Response> {
  return runIntegrationRoute(request, {
    action: "api.v1.timer.get",
    invoke: (tokenHash) => getTimer(tokenHash),
  });
}
