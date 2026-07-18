import { runIntegrationRoute } from "@/lib/integrations/api-auth";
import { listProjects } from "@/lib/integrations/service";

/**
 * GET /api/v1/projects — active/paused projects of the token's team
 * (SAL-051). `api_list_projects` builds from a hard column allow-list:
 * structurally rate-free.
 */
export async function GET(request: Request): Promise<Response> {
  return runIntegrationRoute(request, {
    action: "api.v1.projects",
    invoke: (tokenHash) => listProjects(tokenHash),
  });
}
