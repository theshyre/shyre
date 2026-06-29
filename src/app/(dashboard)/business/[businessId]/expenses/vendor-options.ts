/**
 * Build the distinct-vendor suggestion list that backs the native
 * `<datalist>` on every expense vendor input (create form + inline
 * cells + the project-page surface).
 *
 * Pure + side-effect-free so it can be unit-tested without a DB.
 * Rules:
 *   - Trim each value; drop blanks / nulls.
 *   - Case-insensitive de-dupe — the FIRST-seen spelling wins, so a
 *     later "aws" doesn't shadow an earlier "AWS". (We can't know
 *     which casing the user prefers; first-seen is stable and cheap.)
 *   - Alphabetise case-insensitively for a predictable dropdown.
 *
 * The list is a convenience, never a constraint: callers always
 * still accept free text, so an incomplete list never blocks entry.
 */
export function dedupeVendors(
  vendors: ReadonlyArray<string | null | undefined>,
): string[] {
  const firstSeenByLower = new Map<string, string>();
  for (const raw of vendors) {
    if (raw == null) continue;
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (!firstSeenByLower.has(key)) {
      firstSeenByLower.set(key, trimmed);
    }
  }
  return Array.from(firstSeenByLower.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
