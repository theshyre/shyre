import { describe, it, expect } from "vitest";
// Runtime import so the module (and its `server-only` guard) executes
// under coverage; the setup file stubs the marker.
import "./provider";
import type {
  DeployProvider,
  EnvTarget,
  UpsertEnvVarInput,
  UpsertEnvVarResult,
} from "./provider";

/**
 * provider.ts is a pure contract module — interfaces only. These are
 * compile-time conformance tests: they pin the contract's shape so a
 * breaking change (renaming a member, making `readEnvVar` required,
 * narrowing `targets`) fails HERE with a readable diff instead of
 * deep inside the Vercel driver or the /system/deploy actions.
 */

/** Minimal conforming implementation — deliberately omits the
 *  optional `readEnvVar` to prove a provider without read support
 *  (e.g. a future Cloudflare Pages driver) still satisfies the
 *  contract. */
class MinimalProvider implements DeployProvider {
  readonly written: UpsertEnvVarInput[] = [];

  async upsertEnvVar(input: UpsertEnvVarInput): Promise<UpsertEnvVarResult> {
    const created = !this.written.some((w) => w.key === input.key);
    this.written.push(input);
    return { envVarId: `env_${input.key}`, created };
  }

  async triggerRedeploy(): Promise<{ deploymentId?: string }> {
    // deploymentId is optional — hook-based providers can't know it.
    return {};
  }
}

describe("DeployProvider contract", () => {
  it("a provider without readEnvVar satisfies the interface, and callers must feature-detect", async () => {
    const provider: DeployProvider = new MinimalProvider();
    // The consuming pattern in /system/deploy: probe only when present.
    expect(provider.readEnvVar).toBeUndefined();
    if (provider.readEnvVar) {
      throw new Error("unreachable — minimal provider has no readEnvVar");
    }
    const redeploy = await provider.triggerRedeploy();
    expect(redeploy.deploymentId).toBeUndefined();
  });

  it("upsertEnvVar carries key/value/targets and reports created vs updated", async () => {
    const provider = new MinimalProvider();
    const input: UpsertEnvVarInput = {
      key: "EMAIL_KEY_ENCRYPTION_KEY",
      value: "secret",
      targets: ["production", "preview", "development"],
      encrypt: true,
    };
    const first = await provider.upsertEnvVar(input);
    expect(first).toEqual({
      envVarId: "env_EMAIL_KEY_ENCRYPTION_KEY",
      created: true,
    });
    // Idempotent second write updates rather than creates.
    const second = await provider.upsertEnvVar(input);
    expect(second.created).toBe(false);
  });

  it("encrypt is optional — a plain (non-secret) env var input compiles and round-trips", async () => {
    const provider = new MinimalProvider();
    const plain: UpsertEnvVarInput = {
      key: "NEXT_PUBLIC_FLAG",
      value: "on",
      targets: ["development"],
    };
    await provider.upsertEnvVar(plain);
    expect(provider.written[0]?.encrypt).toBeUndefined();
  });

  it("EnvTarget models a provider tier by name", () => {
    const tier: EnvTarget = { name: "production" };
    expect(tier.name).toBe("production");
  });
});
