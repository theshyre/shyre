/**
 * Shared billable-rate cascade: project → customer → member → team
 * default. This is the same fallback order `/invoices/new` uses when
 * computing a candidate time entry's rate (see the `candidates`
 * mapping in `invoices/new/page.tsx`) — the source of truth for
 * "what rate applies to this hour." Extracted here (audit batch C)
 * so `/reports` computes revenue with the identical cascade instead
 * of its own partial copy (which previously skipped the member-rate
 * step and read raw, unmasked columns — see the Phase 2a `_v` view
 * contract in `supabase/migrations/20260417000519_phase2a_rate_views.sql`).
 *
 * Callers MUST read every input from the corresponding masked `_v`
 * view (`projects_v`, `customers_v`, `team_members_v`,
 * `team_settings_v`), never the base table, when the viewer might not
 * be a team owner/admin — a masked rate comes back as `NULL` from
 * those views, and `resolveRate` treats a masked rate exactly like an
 * absent one: it falls through to the next level. That's intentional,
 * not a leak — each level's visibility is independently configured
 * (`rate_visibility`), so falling through to a level the viewer IS
 * allowed to see is correct. `resolveRate` returning `null` means no
 * level resolved to a visible rate at all; callers should render an
 * explicit "unknown" state (e.g. "—") rather than assuming 0.
 */

export interface RateCascadeInput {
  /** The specific project's hourly_rate, from `projects_v`. */
  projectRate: number | null;
  /** The entry's customer's default_rate, from `customers_v`. */
  customerRate: number | null;
  /** The entry's author's default_rate on this team, from `team_members_v`. */
  memberRate: number | null;
  /** The team's default_rate, from `team_settings_v`. */
  teamDefaultRate: number | null;
}

/**
 * Resolve the effective billable rate for one unit of work (typically
 * one time entry), applying the cascade in order and stopping at the
 * first non-null value. Returns `null` when nothing in the cascade
 * resolves — callers must not silently treat that as 0.
 */
export function resolveRate(input: RateCascadeInput): number | null {
  if (input.projectRate != null) return input.projectRate;
  if (input.customerRate != null) return input.customerRate;
  if (input.memberRate != null) return input.memberRate;
  if (input.teamDefaultRate != null) return input.teamDefaultRate;
  return null;
}
