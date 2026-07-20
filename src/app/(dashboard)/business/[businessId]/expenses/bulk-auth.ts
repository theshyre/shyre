import { isTeamAdmin, type TeamRole } from "@/lib/team-roles";

/**
 * Pure authorization filter for bulk expense actions. Given the
 * caller's user id, a list of expense rows (id + team_id + user_id),
 * and a map of role-by-team for the teams in the row set, return
 * the subset of ids the caller is allowed to mutate.
 *
 * Rule: a row is authorized iff caller is the author OR holds
 * owner|admin role on the row's team. Mirrors the per-row delete
 * + update gates, just applied across an array. Filtered-out ids
 * fail silently — the per-row RLS would block the write anyway,
 * and we don't want to leak existence of rows in other teams via
 * an error message.
 *
 * Imports from `@/lib/team-roles` (not `@/lib/team-context`) so this
 * pure helper stays free of the server-only Supabase client — same
 * rationale as team-section.tsx's client-side use of isTeamAdmin.
 */

export interface ExpenseAuthRow {
  id: string;
  team_id: string;
  user_id: string;
}

export function filterAuthorizedExpenseIds(
  rows: readonly ExpenseAuthRow[],
  callerUserId: string,
  roleByTeam: ReadonlyMap<string, TeamRole>,
): string[] {
  const authorized: string[] = [];
  for (const row of rows) {
    const role = roleByTeam.get(row.team_id) ?? "member";
    const isAuthor = row.user_id === callerUserId;
    if (isAuthor || isTeamAdmin(role)) {
      authorized.push(row.id);
    }
  }
  return authorized;
}
