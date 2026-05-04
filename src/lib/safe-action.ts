"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { toAppError } from "@/lib/errors";
import { logError } from "@/lib/logger";
import type { SerializedAppError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionResult =
  | { success: true }
  | { success: false; error: SerializedAppError };

export interface ActionContext {
  supabase: SupabaseClient;
  userId: string;
}

/**
 * Run a server action with auth, error handling, and logging.
 * Call this INSIDE each exported async function (not as a wrapper).
 *
 * Usage (no team context):
 *   export async function myAction(formData: FormData) {
 *     return runSafeAction(formData, async (fd, { supabase, userId }) => {
 *       // ... action logic
 *     }, "myAction");
 *   }
 *
 * Usage (team-scoped — recommended for any action that mutates a
 * team's data, so error_logs.team_id captures which team the
 * failure belonged to):
 *   export async function myAction(formData: FormData) {
 *     return runSafeAction(formData, async (fd, { supabase, userId }) => {
 *       // ... action logic
 *     }, { actionName: "myAction", teamIdFrom: (fd) => fd.get("team_id") as string });
 *   }
 *
 * The teamIdFrom callback runs *after* the actionFn settles so an
 * action that mutates `team_id` mid-flight can't leak a stale value
 * into the error log. If the callback throws or returns null/empty,
 * the team_id is just omitted — no second-order failure.
 */
export interface RunSafeActionOptions {
  actionName: string;
  teamIdFrom?: (formData: FormData) => string | null | undefined;
}

export async function runSafeAction(
  formData: FormData,
  actionFn: (formData: FormData, ctx: ActionContext) => Promise<void>,
  actionNameOrOpts: string | RunSafeActionOptions
): Promise<ActionResult> {
  const opts: RunSafeActionOptions =
    typeof actionNameOrOpts === "string"
      ? { actionName: actionNameOrOpts }
      : actionNameOrOpts;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  try {
    await actionFn(formData, { supabase, userId: user.id });
    return { success: true };
  } catch (err: unknown) {
    // Let Next.js internal throws pass through (redirect, notFound)
    if (isNextInternalError(err)) {
      throw err;
    }

    const appError = toAppError(err);

    let teamId: string | undefined;
    if (opts.teamIdFrom) {
      try {
        const v = opts.teamIdFrom(formData);
        if (typeof v === "string" && v.length > 0) teamId = v;
      } catch {
        // Resolver-side failure shouldn't abort error logging.
      }
    }

    logError(appError, {
      userId: user.id,
      action: opts.actionName,
      ...(teamId ? { teamId } : {}),
    });

    return { success: false, error: appError.toUserSafe() };
  }
}

/**
 * Check if an error is a Next.js internal throw (redirect, notFound).
 */
function isNextInternalError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: string }).digest;
  if (typeof digest !== "string") return false;
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND");
}
