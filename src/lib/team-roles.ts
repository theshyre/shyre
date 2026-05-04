/**
 * Pure team-role predicates.
 *
 * Lives in its own module (no server-only imports) so client
 * components can call `isTeamAdmin(currentRole)` without dragging
 * the Supabase server client into the browser bundle. Re-exported
 * from `@/lib/team-context` so server-side call sites can keep
 * using the canonical import path.
 *
 * The actual enforcement helpers (`requireTeamAdmin`,
 * `validateTeamAccess`) live in `team-context.ts` because they need
 * the server Supabase client.
 */

/** The role values that grant write access to a team's
 *  configuration. The upcoming `billing_admin` role per
 *  `docs/reference/rate-and-access-plan.md` Phase 2 will extend
 *  this set; that's why the check goes through this helper rather
 *  than being inlined as a literal comparison. */
export type TeamRole = "owner" | "admin" | "member";
export type TeamAdminRole = "owner" | "admin";

/** Type-narrowing predicate: is this role allowed to admin a team? */
export function isTeamAdmin(role: TeamRole): role is TeamAdminRole {
  return role === "owner" || role === "admin";
}
