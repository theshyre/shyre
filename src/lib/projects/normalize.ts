/**
 * Normalize a GitHub repo identifier to canonical `owner/repo` form.
 *
 * Accepts the shapes users actually paste:
 *   - owner/repo                              (canonical)
 *   - https://github.com/owner/repo           (browser address bar)
 *   - https://github.com/owner/repo.git       (clone URL)
 *   - https://github.com/owner/repo/...       (deep link, tree/blob/etc.)
 *   - github.com/owner/repo                   (no protocol)
 *   - git@github.com:owner/repo.git           (SSH clone URL)
 *
 * Returns null on empty / whitespace-only input. Throws a user-facing
 * Error on a non-empty value that can't be coerced into owner/repo —
 * runSafeAction surfaces the message inline on the form.
 *
 * Why throw rather than silently accept and let the resolver fail
 * later: the project save is the right place for this validation.
 * `ticketUrl()` in `src/lib/tickets/detect.ts` builds
 * `https://github.com/{stored}/issues/{n}`, so a stored full URL
 * would silently double-prefix and break every ticket chip on the
 * project. Catching it here keeps later code simple.
 */
export function normalizeGithubRepo(
  value: FormDataEntryValue | string | null,
): string | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;

  // SSH clone: git@github.com:owner/repo.git → owner/repo.git
  const sshMatch = s.match(/^git@github\.com:(.+)$/i);
  if (sshMatch && sshMatch[1]) s = sshMatch[1];

  // Strip protocol + host so https://github.com/owner/repo and
  // github.com/owner/repo collapse to owner/repo.
  s = s.replace(/^https?:\/\//i, "").replace(/^github\.com\//i, "");

  // Strip trailing .git (clone URLs) and trailing slashes.
  s = s.replace(/\.git$/i, "").replace(/\/+$/, "");

  // Take only the first two non-empty path segments — anything past
  // owner/repo is a deep link (tree/main, issues/42, etc.) we don't
  // need to keep.
  const segs = s.split("/").filter(Boolean);
  if (segs.length < 2) {
    throw new Error(
      "GitHub repo must be in owner/repo form (e.g. theshyre/shyre).",
    );
  }
  const candidate = `${segs[0]}/${segs[1]}`;

  // GitHub usernames: alphanumeric + hyphen.
  // Repo names: alphanumeric + dot + underscore + hyphen.
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(candidate)) {
    throw new Error(
      "GitHub repo must be in owner/repo form (e.g. theshyre/shyre).",
    );
  }
  return candidate;
}
