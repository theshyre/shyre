"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppError, toAppError } from "@/lib/errors";
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
 * Wrap a server action with auth, error handling, and logging.
 * The "do it once" pattern — every server action uses this.
 *
 * - Creates Supabase client and verifies auth
 * - Catches errors → classifies → logs → returns structured result
 * - Passes through Next.js redirect() and notFound() throws
 */
export function safeAction(
  actionFn: (formData: FormData, ctx: ActionContext) => Promise<void>,
  actionName?: string
): (formData: FormData) => Promise<void> {
  // Runtime return type is ActionResult, but typed as void for <form action> compat.
  // useFormAction inspects the result at runtime via duck-typing.
  const wrapped = async (formData: FormData): Promise<ActionResult> => {
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

      // Log the error (fire and forget)
      logError(appError, {
        userId: user.id,
        action: actionName ?? actionFn.name ?? "unknown",
      });

      return { success: false, error: appError.toUserSafe() };
    }
  };

  // Cast: runtime returns ActionResult, typed as void for React form action compat
  return wrapped as unknown as (formData: FormData) => Promise<void>;
}

/**
 * Check if an error is a Next.js internal throw (redirect, notFound).
 * These must be re-thrown, not caught.
 */
function isNextInternalError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: string }).digest;
  if (typeof digest !== "string") return false;
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND");
}
