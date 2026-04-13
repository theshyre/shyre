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
 * Usage:
 *   export async function myAction(formData: FormData) {
 *     return runSafeAction(formData, async (fd, { supabase, userId }) => {
 *       // ... action logic
 *     }, "myAction");
 *   }
 */
export async function runSafeAction(
  formData: FormData,
  actionFn: (formData: FormData, ctx: ActionContext) => Promise<void>,
  actionName: string
): Promise<ActionResult> {
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

    logError(appError, {
      userId: user.id,
      action: actionName,
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
