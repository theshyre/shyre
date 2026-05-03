"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk, AppError } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { isSystemAdmin } from "@/lib/system-admin";
import { deployProviderFor } from "@/lib/deploy";

/**
 * Save the deployment-provider connection (Vercel API token,
 * project ID, optional team ID, deploy hook URL). Validates the
 * token by calling Vercel's `/v9/projects/{id}/env` endpoint
 * before persisting — a saved-but-broken token is worse than no
 * connection at all (the user thinks they're set up).
 */
export async function updateDeployConfigAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    if (!(await isSystemAdmin())) {
      throw AppError.refusal("System admins only.");
    }

    const apiToken = ((formData.get("api_token") as string) ?? "").trim();
    const projectId = ((formData.get("project_id") as string) ?? "").trim();
    const vercelTeamId =
      ((formData.get("vercel_team_id") as string) ?? "").trim() || null;
    const deployHookUrl =
      ((formData.get("deploy_hook_url") as string) ?? "").trim() || null;

    if (!apiToken) throw new Error("Vercel API token is required.");
    if (!projectId) throw new Error("Vercel project ID is required.");
    if (deployHookUrl && !/^https:\/\/api\.vercel\.com\//.test(deployHookUrl)) {
      throw new Error(
        "Deploy hook URL must start with https://api.vercel.com/ — copy it from Vercel project Settings → Git → Deploy Hooks.",
      );
    }

    // Validate by listing env vars. A 401 / 403 surfaces here
    // rather than on the next provision call.
    const provider = deployProviderFor("vercel", {
      apiToken,
      projectId,
      vercelTeamId,
      deployHookUrl,
    });
    if (provider.readEnvVar) {
      try {
        await provider.readEnvVar("__validation_probe__");
      } catch (err) {
        throw new Error(
          `Could not reach Vercel with that token / project. Details: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    assertSupabaseOk(
      await supabase.from("instance_deploy_config").upsert(
        {
          id: 1,
          provider: "vercel",
          api_token: apiToken,
          project_id: projectId,
          vercel_team_id: vercelTeamId,
          deploy_hook_url: deployHookUrl,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      ),
    );

    revalidatePath("/system/deploy");
  }, "updateDeployConfigAction") as unknown as void;
}

/**
 * Generate a fresh 32-byte hex EMAIL_KEY_ENCRYPTION_KEY, write it
 * to the configured Vercel project's env vars, and trigger a
 * redeploy. Idempotent — running it twice replaces the key.
 *
 * **Destructive when re-running on a populated instance**: any
 * existing team_email_config rows have their api_key_encrypted
 * (and dek_encrypted) wrapped under the old KEK. Re-keying makes
 * those unreadable. The page-level UI shows a warning + requires
 * an explicit `confirm` form field set to `regenerate` to allow
 * the call when the env var is already present in the running
 * deployment. First-run path (no existing key) skips that gate.
 */
export async function provisionEncryptionKeyAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    if (!(await isSystemAdmin())) {
      throw AppError.refusal("System admins only.");
    }

    const alreadyConfigured = Boolean(process.env.EMAIL_KEY_ENCRYPTION_KEY);
    const confirm = ((formData.get("confirm") as string) ?? "").trim();
    if (alreadyConfigured && confirm !== "regenerate") {
      throw AppError.refusal(
        "EMAIL_KEY_ENCRYPTION_KEY is already set. To rotate, type 'regenerate' in the confirm field. Note: existing stored API keys will become unrecoverable.",
      );
    }

    const { data: cfg } = await supabase
      .from("instance_deploy_config")
      .select("api_token, project_id, vercel_team_id, deploy_hook_url")
      .eq("id", 1)
      .maybeSingle();
    if (!cfg?.api_token || !cfg?.project_id) {
      throw new Error(
        "Connect Vercel first (paste API token + project ID).",
      );
    }

    // 32 random bytes, hex-encoded — matches `openssl rand -hex 32`.
    const newKey = randomBytes(32).toString("hex");

    const provider = deployProviderFor("vercel", {
      apiToken: cfg.api_token as string,
      projectId: cfg.project_id as string,
      vercelTeamId: (cfg.vercel_team_id as string | null) ?? null,
      deployHookUrl: (cfg.deploy_hook_url as string | null) ?? null,
    });

    await provider.upsertEnvVar({
      key: "EMAIL_KEY_ENCRYPTION_KEY",
      value: newKey,
      targets: ["production", "preview", "development"],
      encrypt: true,
    });

    if (cfg.deploy_hook_url) {
      await provider.triggerRedeploy();
    }

    assertSupabaseOk(
      await supabase
        .from("instance_deploy_config")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", 1),
    );

    revalidatePath("/system/deploy");
  }, "provisionEncryptionKeyAction") as unknown as void;
}

/**
 * Generic env-var setter for non-generated values (RESEND_WEBHOOK_SECRET
 * etc.). User pastes the value (from Resend dashboard); Shyre writes
 * to Vercel + triggers redeploy.
 *
 * Allow-listed keys only — guards against a forged action POST
 * setting arbitrary env vars on the user's project.
 */
const ALLOWED_ENV_KEYS = new Set([
  "RESEND_WEBHOOK_SECRET",
]);

export async function setEnvVarAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    if (!(await isSystemAdmin())) {
      throw AppError.refusal("System admins only.");
    }

    const key = ((formData.get("key") as string) ?? "").trim();
    const value = ((formData.get("value") as string) ?? "").trim();
    if (!ALLOWED_ENV_KEYS.has(key)) {
      throw new Error(`Env var key not in allow-list: ${key}`);
    }
    if (!value) {
      throw new Error("Value is required.");
    }

    const { data: cfg } = await supabase
      .from("instance_deploy_config")
      .select("api_token, project_id, vercel_team_id, deploy_hook_url")
      .eq("id", 1)
      .maybeSingle();
    if (!cfg?.api_token || !cfg?.project_id) {
      throw new Error(
        "Connect Vercel first (paste API token + project ID).",
      );
    }

    const provider = deployProviderFor("vercel", {
      apiToken: cfg.api_token as string,
      projectId: cfg.project_id as string,
      vercelTeamId: (cfg.vercel_team_id as string | null) ?? null,
      deployHookUrl: (cfg.deploy_hook_url as string | null) ?? null,
    });

    await provider.upsertEnvVar({
      key,
      value,
      targets: ["production", "preview", "development"],
      encrypt: true,
    });
    if (cfg.deploy_hook_url) {
      await provider.triggerRedeploy();
    }

    assertSupabaseOk(
      await supabase
        .from("instance_deploy_config")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", 1),
    );

    revalidatePath("/system/deploy");
  }, "setEnvVarAction") as unknown as void;
}

/** Trigger a redeploy without changing any env vars. Useful for
 *  picking up a manually-edited Vercel env without leaving the
 *  Shyre admin surface. */
export async function triggerRedeployAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    void formData;
    if (!(await isSystemAdmin())) {
      throw AppError.refusal("System admins only.");
    }
    const { data: cfg } = await supabase
      .from("instance_deploy_config")
      .select("api_token, project_id, vercel_team_id, deploy_hook_url")
      .eq("id", 1)
      .maybeSingle();
    if (!cfg?.deploy_hook_url) {
      throw new Error(
        "Deploy hook URL not configured. Add one in Vercel project Settings → Git → Deploy Hooks.",
      );
    }
    const provider = deployProviderFor("vercel", {
      apiToken: cfg.api_token as string,
      projectId: cfg.project_id as string,
      vercelTeamId: (cfg.vercel_team_id as string | null) ?? null,
      deployHookUrl: cfg.deploy_hook_url as string,
    });
    await provider.triggerRedeploy();
    revalidatePath("/system/deploy");
  }, "triggerRedeployAction") as unknown as void;
}
