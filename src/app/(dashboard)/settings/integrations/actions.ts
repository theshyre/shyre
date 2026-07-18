"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { runSafeAction } from "@/lib/safe-action";
import { isTeamAdmin, validateTeamAccess } from "@/lib/team-context";
import { AppError, toAppError, type SerializedAppError } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { generateIntegrationToken } from "@/lib/integrations/tokens";
import {
  DEFAULT_TOKEN_TTL_DAYS,
  MAX_TOKEN_TTL_DAYS,
  TOKEN_TTL_PRESETS,
} from "./token-constants";

/**
 * Server actions for the /settings/integrations surface (SAL-051 P1).
 *
 * Security notes:
 *   - `token_hash` is written exactly once (the INSERT) and NEVER read
 *     back — no select on this surface may mention it (enforced by
 *     `no-token-hash-select.test.ts`, same rule as `github_token`).
 *   - The raw token is returned to the caller ONCE and never logged;
 *     `logError` calls in this module carry ids only.
 *   - RLS is the authority for creation (self-only + membership + team
 *     kill switch) and revocation (owner or team admin); the trigger
 *     `tg_integration_tokens_revoke_only` guarantees revoke is the only
 *     possible update.
 */

export interface CreateTokenResult {
  success: boolean;
  /** The full raw token. Present ONLY on success, shown ONCE. */
  rawToken?: string;
  error?: SerializedAppError;
}

/** Narrow a FormData value to a string — a crafted multipart request
 *  can put a File where the UI sends text, and calling `.trim()` on it
 *  would surface a TypeError to the client. */
function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Create a new personal access token for the calling user on the given
 * team. Returns the raw token a single time; only the sha256 hash and a
 * display prefix are stored.
 *
 * Hand-rolled (not `runSafeAction`) because the success path must carry
 * a payload — the raw token — which the void-shaped helper can't
 * return. Error handling mirrors it: every failure is logged via
 * `logError` and serialized with `toUserSafe()`.
 */
export async function createIntegrationTokenAction(
  formData: FormData,
): Promise<CreateTokenResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const teamId = formString(formData, "team_id");

  try {
    if (!teamId) throw AppError.validation("Team id is required.");
    // Two-layer authorization (SAL-002 lineage): membership is checked
    // server-side even though the RLS WITH CHECK would also block a
    // foreign team_id. This also keeps the 42501 mapping below
    // unambiguous — it can only mean "kill switch off".
    await validateTeamAccess(teamId);

    const name = formString(formData, "name").trim();
    if (name.length < 1 || name.length > 100) {
      throw AppError.validation("Token name is required.", {
        name: "integrations.create.nameRequired",
      });
    }

    const ttlDays = parseInt(
      formString(formData, "ttl_days") || String(DEFAULT_TOKEN_TTL_DAYS),
      10,
    );
    if (
      !TOKEN_TTL_PRESETS.includes(ttlDays) ||
      ttlDays > MAX_TOKEN_TTL_DAYS
    ) {
      throw AppError.validation(`Invalid expiry "${ttlDays}".`);
    }

    const billableRaw = formData.get("default_billable");
    if (billableRaw !== "true" && billableRaw !== "false") {
      throw AppError.validation("Choose a billable default.");
    }

    const token = generateIntegrationToken();
    const expiresAt = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error } = await supabase.from("integration_tokens").insert({
      user_id: user.id,
      team_id: teamId,
      name,
      token_hash: token.hash,
      token_prefix: token.prefix,
      expires_at: expiresAt,
      default_billable: billableRaw === "true",
    });

    if (error) {
      // 42501 = RLS WITH CHECK rejection. Membership was verified
      // above, so on this policy it means the team kill switch is
      // off — surface the default-closed explanation instead of a
      // raw permissions error.
      if (error.code === "42501") {
        throw new AppError({
          code: "AUTH_FORBIDDEN",
          message: "integration_tokens insert rejected by RLS",
          userMessageKey: "integrations.errors.disabled",
        });
      }
      // Classify instead of rethrowing raw — a raw PostgrestError
      // normalizes to UNKNOWN, whose message (constraint names, type
      // parse errors) is forwarded verbatim to the client.
      throw AppError.fromSupabase(error);
    }

    revalidatePath("/settings/integrations");
    return { success: true, rawToken: token.raw };
  } catch (err: unknown) {
    const appError = toAppError(err);
    logError(appError, {
      userId: user.id,
      action: "createIntegrationTokenAction",
      ...(teamId ? { teamId } : {}),
    });
    return { success: false, error: appError.toUserSafe() };
  }
}

/**
 * Revoke a token: stamps `revoked_at` — the only mutation the DB
 * trigger permits. RLS decides who may do it (the token's owner, or an
 * owner/admin of its team). Irreversible by design; integrations using
 * the token stop immediately.
 */
export async function revokeIntegrationTokenAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const tokenId = formString(fd, "token_id");
      if (!tokenId) throw AppError.validation("Token id is required.");

      const { data, error } = await supabase
        .from("integration_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", tokenId)
        .is("revoked_at", null)
        .select("id");
      if (error) throw AppError.fromSupabase(error);
      // RLS filters silently — zero updated rows means the token
      // doesn't exist, isn't yours to revoke, or is already revoked.
      // Expected refusal (stale page, double click) — severity info so
      // it doesn't demand admin triage in /admin/errors.
      if (!data || data.length === 0) {
        throw new AppError({
          code: "NOT_FOUND",
          message: "integration token missing or already revoked",
          userMessageKey: "integrations.errors.revokeNotFound",
          severity: "info",
        });
      }

      revalidatePath("/settings/integrations");
    },
    {
      actionName: "revokeIntegrationTokenAction",
      teamIdFrom: (fd) => fd.get("team_id") as string,
    },
  ) as unknown as void;
}

/**
 * Flip the per-team integrations kill switch. Owner/admin only (via the
 * canonical `isTeamAdmin` predicate). Turning it OFF dead-ends every
 * existing token instantly — `api_resolve_token` re-checks the flag on
 * each request.
 */
export async function setIntegrationsEnabledAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = formString(fd, "team_id");
      if (!teamId) throw AppError.validation("Team id is required.");

      const { role } = await validateTeamAccess(teamId);
      if (!isTeamAdmin(role)) {
        throw new AppError({
          code: "AUTH_FORBIDDEN",
          message: "integrations toggle rejected: caller is not a team admin",
          userMessageKey: "integrations.errors.adminOnly",
        });
      }

      const enabledRaw = fd.get("enabled");
      if (enabledRaw !== "true" && enabledRaw !== "false") {
        throw AppError.validation("Invalid value for integrations toggle.");
      }

      const { error } = await supabase.from("team_settings").upsert({
        team_id: teamId,
        integrations_enabled: enabledRaw === "true",
      });
      if (error) throw AppError.fromSupabase(error);

      revalidatePath("/settings/integrations");
    },
    {
      actionName: "setIntegrationsEnabledAction",
      teamIdFrom: (fd) => fd.get("team_id") as string,
    },
  ) as unknown as void;
}
