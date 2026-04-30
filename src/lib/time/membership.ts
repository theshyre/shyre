/**
 * Defense-in-depth pre-membership clamp for self-scoped time-entries reads.
 *
 * Per the doc decision (closed 2026-04-30, security review — see
 * docs/reference/unified-time.md §Authorization & cross-team safety): when
 * a user is reading their own time entries (self-scoped path), clamp
 * `start_time >= team_members.joined_at` so they never see entries from
 * before they joined the team. Owner/admin paths are unchanged; this is
 * only the self-scoped tightening.
 *
 * RLS already prevents non-members from reading rows. The defense-in-depth
 * gate addresses the edge case of a re-added member who would otherwise
 * see their own pre-leave entries on a deep scroll. Cheap (one query),
 * pre-empts the SAL we'd otherwise write the day someone notices.
 *
 * Phase-1 limitation: applies only to single-team queries (selectedTeamId
 * set). Multi-team self-scoped queries (`/time-entries` with no team
 * filter) accept the looser floor today; revisit if/when the Log surfaces
 * cross-team scroll, which the design currently blocks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetch `team_members.joined_at` for the given (user, team). Returns null
 * if no membership row exists.
 */
export async function getMembershipJoinedAt(
  supabase: SupabaseClient,
  userId: string,
  teamId: string,
): Promise<Date | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("joined_at")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error || !data?.joined_at) return null;
  return new Date(data.joined_at as string);
}

/**
 * Compute the effective lower bound for a self-scoped time-entries query.
 *
 * Returns the later of `windowStart` and `joined_at` (when self-scoped
 * and a single team is selected). Returns `windowStart` unchanged in any
 * other case.
 *
 * `memberFilter` semantics match `page.tsx`:
 *   - null → no user filter (e.g. owner viewing all)
 *   - [callerId] → self-scoped (the case this gate exists for)
 *   - any other shape → not self-scoped; no clamp
 */
export async function selfScopedFloor(
  supabase: SupabaseClient,
  callerId: string,
  selectedTeamId: string | null,
  memberFilter: string[] | null,
  windowStart: Date,
): Promise<Date> {
  if (!selectedTeamId) return windowStart;
  if (memberFilter === null) return windowStart;
  if (memberFilter.length !== 1 || memberFilter[0] !== callerId) {
    return windowStart;
  }
  const joinedAt = await getMembershipJoinedAt(supabase, callerId, selectedTeamId);
  if (!joinedAt) return windowStart;
  return joinedAt > windowStart ? joinedAt : windowStart;
}
