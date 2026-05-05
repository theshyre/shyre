/**
 * TOTP URI rewriting for MFA enrollment.
 *
 * Supabase's `auth.mfa.enroll({ factorType: "totp" })` returns a
 * `totp.uri` that uses the project's display name as both the
 * issuer and the account label. We want our authenticator-app
 * entry to read "malcom.io · marcus@example.com" — the issuer is
 * the user-visible identity of the application, not the Supabase
 * project ref.
 *
 * Pulling this out into a pure helper lets us test the rewrite
 * logic without spinning up Supabase. The component just calls
 * `rewriteTotpUri(originalUri, { email, issuer })` and feeds the
 * result to the QR code.
 *
 * Also defends against a malformed Supabase response: missing
 * params get sensible defaults rather than crashing.
 */

export interface RewriteOptions {
  /** User's email (otpauth label). */
  email: string;
  /** Issuer string the authenticator app displays. */
  issuer: string;
}

/** Returns a fresh `otpauth://totp/<issuer>:<email>?...` URI with
 *  the issuer + label replaced and the existing crypto params
 *  (secret, period, digits, algorithm) preserved. */
export function rewriteTotpUri(
  originalUri: string,
  options: RewriteOptions,
): string {
  const url = new URL(originalUri);
  const secret = url.searchParams.get("secret") ?? "";
  const period = url.searchParams.get("period") ?? "30";
  const digits = url.searchParams.get("digits") ?? "6";
  const algorithm = url.searchParams.get("algorithm") ?? "SHA1";
  const issuer = options.issuer;
  const email = options.email;

  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}` +
    `&period=${period}&digits=${digits}&algorithm=${algorithm}`
  );
}
