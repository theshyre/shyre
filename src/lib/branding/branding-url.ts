/**
 * Pure validator for a branding logo URL before it lands on a DB column
 * (`team_settings.logo_url`, `customers.logo_url`). Lives outside any
 * `"use server"` module so it can be imported freely.
 *
 * A stored logo URL MUST be a same-origin Supabase Storage URL in the public
 * `branding` bucket whose first path segment is the owning `team_id`. This
 * blocks two things: pointing the column at an off-site URL (an attacker could
 * host a tracking pixel / phishing image that renders on the PDF + the
 * login-free sign page under the team's name — the SAL-039 lesson applied to
 * images), and pointing it at another team's folder.
 */
export function isOwnBrandingUrl(candidate: string, teamId: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;

  let parsed: URL;
  let baseParsed: URL;
  try {
    parsed = new URL(candidate);
    baseParsed = new URL(base);
  } catch {
    return false;
  }
  if (parsed.origin !== baseParsed.origin) return false;

  // Supabase public storage URL: /storage/v1/object/public/<bucket>/<path...>
  const segments = parsed.pathname.split("/").filter(Boolean);
  const bucketIdx = segments.indexOf("branding");
  if (bucketIdx === -1) return false;
  // The segment right after the bucket is the team folder.
  const teamSegment = segments[bucketIdx + 1];
  return teamSegment === teamId;
}
