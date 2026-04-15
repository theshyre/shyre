import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toAppError } from "@/lib/errors";
import type { AppError } from "@/lib/errors";

interface LogErrorContext {
  userId?: string;
  teamId?: string;
  url?: string;
  action?: string;
}

/**
 * Log an error to the error_logs table.
 * Fire-and-forget — never throws, never blocks the caller.
 * Falls back to console.error if DB write fails.
 */
export function logError(
  error: AppError | Error | unknown,
  context: LogErrorContext = {}
): void {
  // Fire and forget — don't await
  void writeErrorLog(error, context);
}

async function writeErrorLog(
  error: AppError | Error | unknown,
  context: LogErrorContext
): Promise<void> {
  const appError = toAppError(error);

  // Preferred path: service-role client, bypasses RLS, works without a user
  // session. Fails if SUPABASE_SERVICE_ROLE_KEY is not configured.
  try {
    const supabase = createAdminClient();
    const { error: insertError } = await supabase.from("error_logs").insert({
      error_code: appError.code,
      message: appError.message,
      user_message_key: appError.userMessageKey,
      details: appError.details,
      user_id: context.userId ?? null,
      team_id: context.teamId ?? null,
      url: context.url ?? null,
      action: context.action ?? null,
      stack_trace: appError.stack ?? null,
      severity: appError.severity,
    });

    if (insertError) {
      console.error("[logger] Admin insert failed:", insertError);
      console.error("[logger] Original error:", appError.message, appError.code);
    } else {
      return;
    }
  } catch (adminErr) {
    // Most common failure: missing SUPABASE_SERVICE_ROLE_KEY.
    console.error("[logger] Admin client unavailable:", adminErr);
  }

  // Fallback path: SECURITY DEFINER RPC. Requires an authenticated user
  // context (works in server components / server actions with a session).
  // Lets us capture errors even when the service role key is missing from
  // the deployment env.
  try {
    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc("log_error_from_user", {
      p_error_code: appError.code,
      p_message: appError.message,
      p_user_message_key: appError.userMessageKey,
      p_details: appError.details ?? null,
      p_url: context.url ?? null,
      p_action: context.action ?? null,
      p_stack_trace: appError.stack ?? null,
      p_severity: appError.severity,
    });
    if (rpcError) {
      console.error("[logger] RPC fallback failed:", rpcError);
      console.error("[logger] Original error:", appError.message, appError.code);
    }
  } catch (fallbackErr) {
    // Last-resort: loud console. Logger must never throw.
    console.error("[logger] All paths failed:", fallbackErr);
    console.error("[logger] Original error:", appError.message, appError.code);
  }
}
