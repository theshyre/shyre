import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-team daily-cap enforcement.
 *
 * Hard limit on outbound *envelopes* per team per rolling 24h
 * window. An envelope is a single addressee on a single message —
 * a 5-recipient send counts as 5 envelopes, the same way Resend
 * bills it. Defends against:
 *
 *   - Compromised account exfiltrating mail through the team's own
 *     Resend key (security review #6).
 *   - Accidental loops (bug in a future cron that re-fires the
 *     same reminder forever).
 *   - Naïve "send to every customer" macro that someone might wire.
 *
 * Implementation: delegates to the `consume_daily_quota` Postgres
 * function, which uses `FOR UPDATE` to serialize concurrent sends
 * + a single conditional UPDATE so the cap can't be bypassed by a
 * read-then-write race. SAL-021.
 *
 * Returns:
 *   - `{ allowed: true, remaining }` — go ahead, send.
 *   - `{ allowed: false, reason: "cap_reached", remaining }`
 *     — over the cap; remaining is the slack left in the window.
 *   - `{ allowed: false, reason: "no_config" }` — config row missing.
 */

export interface RateLimitDecision {
  allowed: boolean;
  reason?: "cap_reached" | "no_config";
  remaining: number;
  cap: number;
}

export async function consumeDailyQuota(
  supabase: SupabaseClient,
  teamId: string,
  /** Number of envelopes to consume — typically the count of
   *  unique To+Cc+Bcc recipients on the message about to send.
   *  Defaults to 1 so legacy callers that haven't migrated still
   *  enforce a sane lower bound. */
  recipientCount: number = 1,
): Promise<RateLimitDecision> {
  const { data, error } = await supabase.rpc("consume_daily_quota", {
    p_team_id: teamId,
    p_amount: recipientCount,
  });

  if (error) {
    // Fail closed: a failure to talk to the RPC is treated as
    // over-cap so a stuck counter or RLS misconfiguration doesn't
    // hide an abuse vector.
    return { allowed: false, reason: "cap_reached", remaining: 0, cap: 0 };
  }

  // The function returns SETOF; supabase-js gives us an array.
  const row = Array.isArray(data) ? (data[0] ?? null) : null;
  if (!row) {
    return { allowed: false, reason: "no_config", remaining: 0, cap: 0 };
  }

  const allowed = Boolean(row.allowed);
  const reason =
    (row.reason as "cap_reached" | "no_config" | null) ?? undefined;
  return {
    allowed,
    ...(reason ? { reason } : {}),
    remaining: Number(row.remaining ?? 0),
    cap: Number(row.cap ?? 0),
  };
}
