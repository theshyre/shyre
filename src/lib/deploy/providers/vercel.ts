import "server-only";

import type {
  DeployProvider,
  UpsertEnvVarInput,
  UpsertEnvVarResult,
} from "../provider";

/**
 * Vercel REST API driver.
 *
 * No `vercel` SDK dependency — direct fetch keeps the surface
 * small and the test mocks trivial. The endpoints in use:
 *
 *   GET    /v9/projects/{projectId}/env       — list env vars
 *   POST   /v9/projects/{projectId}/env       — create env var
 *   PATCH  /v9/projects/{projectId}/env/{id}  — update env var
 *   POST   <deployHookUrl>                    — trigger redeploy
 *
 * For team accounts, every project endpoint takes `?teamId=...`
 * as a query string.
 */

interface VercelEnvVar {
  id: string;
  key: string;
  value?: string;
  type: "encrypted" | "plain" | "system" | "secret";
  target: string[];
}

export interface VercelDriverConfig {
  apiToken: string;
  projectId: string;
  /** Vercel team id (`team_...`) for team-scoped projects. Personal
   *  accounts pass null. */
  vercelTeamId: string | null;
  /** Project deploy-hook URL (project Settings → Git → Deploy
   *  Hooks). Posting triggers a redeploy with the latest commit. */
  deployHookUrl: string | null;
}

export function vercelProvider(cfg: VercelDriverConfig): DeployProvider {
  if (!cfg.apiToken) throw new Error("Vercel API token is required.");
  if (!cfg.projectId) throw new Error("Vercel project ID is required.");

  const teamSuffix = cfg.vercelTeamId
    ? `?teamId=${encodeURIComponent(cfg.vercelTeamId)}`
    : "";

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`https://api.vercel.com${path}${teamSuffix}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        "Content-Type": "application/json",
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new VercelError(res.status, body, path);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function listEnvVars(): Promise<VercelEnvVar[]> {
    const res = await call<{ envs: VercelEnvVar[] }>(
      `/v9/projects/${encodeURIComponent(cfg.projectId)}/env`,
      { method: "GET" },
    );
    return res.envs ?? [];
  }

  return {
    async upsertEnvVar(
      input: UpsertEnvVarInput,
    ): Promise<UpsertEnvVarResult> {
      const all = await listEnvVars();
      // Match by key + target set so the same key with different
      // targets doesn't collide. The user's intent on /system/deploy
      // is "the encryption key for production" — so we update every
      // existing row with the same key whose targets overlap, and
      // create a new row only when nothing matches.
      const matching = all.filter(
        (e) =>
          e.key === input.key &&
          e.target.some((t) => input.targets.includes(t)),
      );
      if (matching.length > 0) {
        // PATCH each matching row with the new value. Vercel's
        // PATCH replaces the value; targets stay as-is.
        for (const m of matching) {
          await call(
            `/v9/projects/${encodeURIComponent(cfg.projectId)}/env/${m.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                value: input.value,
                target: m.target,
                type: input.encrypt === false ? "plain" : "encrypted",
              }),
            },
          );
        }
        return { envVarId: matching[0]!.id, created: false };
      }
      // No existing row — create.
      const created = await call<VercelEnvVar>(
        `/v9/projects/${encodeURIComponent(cfg.projectId)}/env`,
        {
          method: "POST",
          body: JSON.stringify({
            key: input.key,
            value: input.value,
            target: input.targets,
            type: input.encrypt === false ? "plain" : "encrypted",
          }),
        },
      );
      return { envVarId: created.id, created: true };
    },

    async triggerRedeploy(): Promise<{ deploymentId?: string }> {
      if (!cfg.deployHookUrl) {
        throw new Error(
          "Deploy hook URL is not configured. Add one in Vercel project Settings → Git → Deploy Hooks and paste it into Shyre.",
        );
      }
      const res = await fetch(cfg.deployHookUrl, { method: "POST" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Deploy hook returned ${res.status}: ${body.slice(0, 200)}`);
      }
      try {
        const data = (await res.json()) as { job?: { id?: string } };
        return { deploymentId: data.job?.id };
      } catch {
        return {};
      }
    },

    async readEnvVar(key: string): Promise<{ exists: boolean; value: string | null }> {
      const all = await listEnvVars();
      const found = all.find((e) => e.key === key);
      if (!found) return { exists: false, value: null };
      // Vercel returns the decrypted value only when explicitly
      // requested via `decrypt=true` on a single-row GET. We
      // don't decrypt by default — `exists` is the signal we use.
      return { exists: true, value: found.value ?? null };
    },
  };
}

export class VercelError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly path: string,
  ) {
    super(`Vercel ${path} returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = "VercelError";
  }
}
