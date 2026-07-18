import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { whoami } from "@/lib/integrations/service";

/**
 * GET /api/v1/me — token introspection (SAL-051).
 * Bearer PAT → `api_whoami`: who am I, which team, which scopes,
 * when does this token expire.
 */
export async function GET(request: Request): Promise<Response> {
  return runIntegrationRoute(request, {
    action: "api.v1.me",
    invoke: (tokenHash) => whoami(tokenHash),
  });
}
