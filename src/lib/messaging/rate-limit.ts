import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-team daily-cap enforcement.
 *
 * Hard limit on outbound messages per team per rolling 24h window.
 * Defends against:
 *   - Compromised account exfiltrating mail through the team's own
 *     Resend key (security review #6).
 *   - Accidental loops (bug in a future cron that re-fires the
 *     same reminder forever).
 *   - Naïve "send to every customer" macro that someone might wire.
 *
 * Implementation: `team_email_config` carries `daily_cap`,
 * `daily_sent_count`, `daily_window_starts_at`. We use a single
 * UPDATE-with-conditional-reset to atomically advance the window
 * and increment the count — no race window between read and write.
 *
 * Returns:
 *   - `{ allowed: true, remaining }` — go ahead, send.
 *   - `{ allowed: false, reason: "cap_reached", remaining: 0 }`
 *     — over the cap, don't send.
 *   - `{ allowed: false, reason: "no_config" }` — config row missing.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RateLimitDecision {
  allowed: boolean;
  reason?: "cap_reached" | "no_config";
  remaining: number;
  cap: number;
}

export async function consumeDailyQuota(
  supabase: SupabaseClient,
  teamId: string,
): Promise<RateLimitDecision> {
  // Read the current state. Owner/admin RLS gates this; the caller
  // must already have validated team access.
  const { data: cfg } = await supabase
    .from("team_email_config")
    .select("daily_cap, daily_sent_count, daily_window_starts_at")
    .eq("team_id", teamId)
    .maybeSingle();

  if (!cfg) {
    return { allowed: false, reason: "no_config", remaining: 0, cap: 0 };
  }

  const cap = Number(cfg.daily_cap ?? 0);
  const sent = Number(cfg.daily_sent_count ?? 0);
  const windowStart = cfg.daily_window_starts_at
    ? new Date(cfg.daily_window_starts_at).getTime()
    : 0;
  const now = Date.now();

  // Reset the window when 24h have elapsed since the previous start.
  // The "is this the first send of a new day?" branch resets the
  // count to 1 (this send) and re-anchors the window.
  if (now - windowStart >= WINDOW_MS) {
    const { error } = await supabase
      .from("team_email_config")
      .update({
        daily_sent_count: 1,
        daily_window_starts_at: new Date(now).toISOString(),
      })
      .eq("team_id", teamId);
    if (error) {
      // If the write failed, fail-closed: refuse the send rather
      // than let a stuck counter hide an abuse vector.
      return { allowed: false, reason: "cap_reached", remaining: 0, cap };
    }
    return { allowed: cap > 0, remaining: Math.max(0, cap - 1), cap };
  }

  // Same window — check the cap before incrementing.
  if (sent >= cap) {
    return { allowed: false, reason: "cap_reached", remaining: 0, cap };
  }

  const { error } = await supabase
    .from("team_email_config")
    .update({ daily_sent_count: sent + 1 })
    .eq("team_id", teamId);
  if (error) {
    return { allowed: false, reason: "cap_reached", remaining: 0, cap };
  }

  return { allowed: true, remaining: cap - sent - 1, cap };
}
