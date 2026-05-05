/**
 * Pure helpers for validating an avatar URL before it lands on
 * `user_profiles.avatar_url`. Lives outside `actions.ts` because that
 * file carries `"use server"` and Next.js refuses to export anything
 * that isn't an async server action from a server-actions module.
 */

/** True when `url` is a same-origin Supabase Storage avatars-bucket
 *  URL whose path includes `/avatars/<userId>/`. We compare against
 *  the configured `NEXT_PUBLIC_SUPABASE_URL` so the check is
 *  environment-agnostic. UUID is stable per user, so the check
 *  rejects anyone stuffing another user's path in. */
export function isOwnSupabaseAvatarUrl(
  candidate: string,
  userId: string,
): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  let baseParsed: URL;
  try {
    baseParsed = new URL(base);
  } catch {
    return false;
  }
  if (parsed.origin !== baseParsed.origin) return false;
  // Supabase public storage URL: /storage/v1/object/public/<bucket>/<path>
  // We want bucket=avatars and the next segment to equal userId.
  const segments = parsed.pathname.split("/").filter(Boolean);
  const i = segments.indexOf("avatars");
  if (i === -1) return false;
  const userSegment = segments[i + 1];
  if (!userSegment || userSegment !== userId) return false;
  return true;
}
