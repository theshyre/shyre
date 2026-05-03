import "server-only";

/**
 * Provider-agnostic deployment-environment contract.
 *
 * Today only Vercel; Cloudflare Pages / Fly.io / Render / etc.
 * plug in via this interface. Shape kept narrow + portable across
 * the major providers — `key`, `value`, `targets` (array of env
 * tier names), and a deploy-trigger.
 */

export interface EnvTarget {
  /** Provider's vocabulary for environment tiers. Vercel uses
   *  "production" / "preview" / "development". */
  name: string;
}

export interface UpsertEnvVarInput {
  key: string;
  value: string;
  /** Which tiers to apply the value to. Most secrets go to all
   *  three; a dev-only value would be ["development"]. */
  targets: string[];
  /** Provider-side encryption hint. Vercel: "encrypted" | "plain"
   *  | "system" — we always use "encrypted" for our secrets. */
  encrypt?: boolean;
}

export interface UpsertEnvVarResult {
  /** Provider env-var ID, useful for audit. */
  envVarId: string;
  created: boolean;
}

export interface DeployProvider {
  /** Add a new env var, or update an existing one with the same key
   *  on the same set of targets. Idempotent. */
  upsertEnvVar(input: UpsertEnvVarInput): Promise<UpsertEnvVarResult>;

  /** Trigger a redeploy so the env var changes take effect. Today
   *  via the provider's deploy-hook URL (a project-specific URL the
   *  user pastes into Shyre once). The provider may queue or run
   *  immediately; we don't poll. */
  triggerRedeploy(): Promise<{ deploymentId?: string }>;

  /** Read an env var's value back. Used by /system/deploy to
   *  display "currently set" without exposing the value (callers
   *  redact). NOT supported by every provider — return null when
   *  unavailable. */
  readEnvVar?(key: string): Promise<{ exists: boolean; value: string | null }>;
}
