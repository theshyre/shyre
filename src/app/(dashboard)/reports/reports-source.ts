/**
 * "Source" lens for the reports page (SAL-051 P3): separate
 * agent-tracked hours from everything a human initiated.
 *
 * Buckets are complementary by design so the math stays honest:
 *   - `agent`  → entries with `started_by_kind = 'agent'`
 *   - `human`  → every OTHER entry ('user', 'integration', 'import' —
 *                all human-initiated even when a tool did the typing)
 *   - `all`    → no filter
 * Human + Agent always sums to All; a `human = 'user'`-only reading
 * would silently drop integration / import rows from both lenses.
 *
 * Pure helpers so the server page and tests share one definition of
 * the filter math.
 */

export type ReportsSource = "all" | "human" | "agent";

const SOURCES: ReadonlySet<string> = new Set(["all", "human", "agent"]);

/** Parse the `source` search param; anything unknown → "all". */
export function resolveReportsSource(
  raw: string | null | undefined,
): ReportsSource {
  if (raw && SOURCES.has(raw)) return raw as ReportsSource;
  return "all";
}

/**
 * Does an entry belong to the selected source bucket? `startedByKind`
 * may be null on rows shaped before the column existed — those are
 * human ('user' is the column default).
 */
export function entryMatchesSource(
  startedByKind: string | null | undefined,
  source: ReportsSource,
): boolean {
  if (source === "all") return true;
  const isAgent = startedByKind === "agent";
  return source === "agent" ? isAgent : !isAgent;
}
