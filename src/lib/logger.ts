import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAppError } from "@/lib/errors";
import type { AppError } from "@/lib/errors";

interface LogErrorContext {
  userId?: string;
  orgId?: string;
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
  try {
    const appError = toAppError(error);
    const supabase = createAdminClient();

    const { error: insertError } = await supabase.from("error_logs").insert({
      error_code: appError.code,
      message: appError.message,
      user_message_key: appError.userMessageKey,
      details: appError.details,
      user_id: context.userId ?? null,
      org_id: context.orgId ?? null,
      url: context.url ?? null,
      action: context.action ?? null,
      stack_trace: appError.stack ?? null,
      severity: appError.severity,
    });

    if (insertError) {
      console.error("[logger] Failed to insert error log:", insertError);
      console.error("[logger] Original error:", appError.message, appError.code);
    }
  } catch (logErr) {
    // Logger must never throw — fall back to console
    console.error("[logger] Exception in writeErrorLog:", logErr);
    console.error("[logger] Original error:", error);
  }
}
