/**
 * Pure preconditions for deleteBusinessAction. Extracted so the
 * decision logic (which is the security gate) can be tested
 * directly without round-tripping through Supabase.
 */

export interface CallerTeamMembership {
  team_id: string;
  role: string;
}

export interface CallerOwnerTeam {
  id: string;
  business_id: string | null;
}

/**
 * Returns true iff every team in `teamIds` has the caller listed
 * as an `owner` in their `team_members` row. An admin on one
 * team but member-only on another fails the check — deleting a
 * business is owner-of-everything.
 */
export function isOwnerOfEveryTeam(
  teamIds: readonly string[],
  callerMemberships: readonly CallerTeamMembership[],
): boolean {
  if (teamIds.length === 0) return false;
  const ownerTeamIds = new Set(
    callerMemberships
      .filter((m) => m.role === "owner")
      .map((m) => m.team_id),
  );
  return teamIds.every((id) => ownerTeamIds.has(id));
}

/**
 * Returns true iff the caller owns at least one team in a
 * business OTHER than the one being deleted. Personal teams
 * (business_id null) don't count — they're not businesses, just
 * the user's solo workspace. Without this, deleting your only
 * business would strand you with no /business detail page to
 * land on.
 */
export function ownsAnotherBusiness(
  ownerTeams: readonly CallerOwnerTeam[],
  businessIdBeingDeleted: string,
): boolean {
  return ownerTeams.some(
    (t) =>
      t.business_id !== null && t.business_id !== businessIdBeingDeleted,
  );
}

/**
 * Compute the expected confirmation string from the same
 * fallback chain as the layout header: legal_name → name → "".
 * Empty string means "the business has no displayable name at
 * all," which the action treats as a refusal condition.
 */
export function expectedConfirmName(
  legalName: string | null,
  name: string | null,
): string {
  return legalName ?? name ?? "";
}
