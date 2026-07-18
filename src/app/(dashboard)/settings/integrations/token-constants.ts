/**
 * Shared constants + row shapes for the /settings/integrations surface.
 *
 * Lives outside `actions.ts` because "use server" modules may only
 * export async functions — runtime constants must come from a plain
 * module. Also deliberately does NOT import `@/lib/integrations/tokens`
 * (a `server-only` module) so client components can use these values;
 * `token-constants.test.ts` asserts parity with the lib's TTL numbers.
 */

/** Mirrors DEFAULT_TOKEN_TTL_DAYS in `@/lib/integrations/tokens`. */
export const DEFAULT_TOKEN_TTL_DAYS = 90;
/** Mirrors MAX_TOKEN_TTL_DAYS in `@/lib/integrations/tokens` and the
 *  DB CHECK (`expires_at <= created_at + interval '1 year'`). */
export const MAX_TOKEN_TTL_DAYS = 365;

/** Expiry presets offered by the create form, in days. */
export const TOKEN_TTL_PRESETS: readonly number[] = [30, 90, 180, 365];

/**
 * A token row as listed on the settings page. Deliberately excludes
 * `token_hash` — the hash is never selected on this surface (enforced
 * by `no-token-hash-select.test.ts`).
 */
export interface IntegrationTokenRow {
  id: string;
  user_id: string;
  team_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  default_billable: boolean;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Minimal author info for the owner/admin token view + activity list. */
export interface TokenOwnerProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface IntegrationEventRow {
  id: number;
  action: string;
  status: "ok" | "denied" | "error";
  occurred_at: string;
  user_id: string;
}
