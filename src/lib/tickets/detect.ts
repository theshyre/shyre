/**
 * Ticket-link detection — pure helpers for spotting Jira / GitHub
 * references inside a free-text description. Server actions call
 * these to decide whether to fire a lookup; the UI calls them to
 * render a chip preview.
 *
 * Detection deliberately surfaces only the FIRST match in a
 * description. A time entry models one task; if the user mentions
 * three tickets in their note we still pick the most prominent one
 * to attach as metadata.
 *
 * Resolution rules:
 *   - Jira: `[A-Z][A-Z0-9_]+-\d+`. Case-sensitive (Atlassian
 *     project keys are uppercase by convention; matching the lower-
 *     case "abc-123" would generate too many false positives —
 *     "iso-8859-1", style guides, etc.).
 *   - GitHub long form: `owner/repo#123`. Owner + repo characters
 *     are `[\w.-]+` per GitHub's rules; the `#` is mandatory so we
 *     don't grab path-style strings.
 *   - GitHub short form: `#123` ONLY when a defaultGithubRepo is
 *     supplied in resolveTicketReference (because a bare "#123" in
 *     a description is meaningless without context).
 *   - Jira short form: bare `123` is too noisy; we don't try.
 *     Users who want short refs use GitHub style or paste the full
 *     Jira key.
 */

export type TicketProvider = "jira" | "github";

export interface DetectedTicket {
  provider: TicketProvider;
  /** The fully-qualified key, e.g. "PROJ-123" or "octokit/rest.js#42". */
  key: string;
  /** The exact substring that matched in the source text — useful
   *  for highlighting the user's input in the UI. */
  matchedText: string;
}

/**
 * Detect the first Jira or GitHub-long ticket reference in a
 * description. Returns null when nothing matches.
 *
 * Long-form GitHub takes precedence over Jira in the same string —
 * "octokit/rest.js#42" wouldn't match Jira anyway, but if the user
 * writes "Worked on PROJ-1 and octokit/rest.js#42" we pick the
 * GitHub one because it's more specific.
 *
 * Note: callers wanting short-form GitHub support (`#123`) must use
 * `resolveTicketReference` instead, which takes a default-repo
 * parameter.
 */
export function detectTicket(description: string): DetectedTicket | null {
  if (!description) return null;

  // GitHub long form. Owner/repo: 1+ chars from [A-Za-z0-9_.-];
  // GitHub additionally forbids leading `.`/`-` and `--`, but
  // accepting them here is harmless — the lookup will 404 cleanly
  // for invalid refs.
  const ghLong = description.match(
    /\b([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/,
  );
  if (ghLong) {
    return {
      provider: "github",
      key: `${ghLong[1]}#${ghLong[2]}`,
      matchedText: ghLong[0],
    };
  }

  // Jira: project key + dash + number. Project key is 2+ uppercase
  // letters/digits, starting with a letter.
  const jira = description.match(/\b([A-Z][A-Z0-9_]+)-(\d+)\b/);
  if (jira) {
    return {
      provider: "jira",
      key: `${jira[1]}-${jira[2]}`,
      matchedText: jira[0],
    };
  }

  return null;
}

export interface ResolveOptions {
  /** Default GitHub repo for the active project, e.g. "octokit/rest.js".
   *  When set, a bare `#123` resolves to `<repo>#123`. */
  defaultGithubRepo?: string | null;
  /** Default Jira project key, e.g. "PROJ". When set, a bare
   *  uppercase `123` would too easily collide with the GitHub short
   *  form so we DON'T support bare-number Jira shortrefs — the user
   *  must still type `PROJ-123` or rely on GitHub `#123`. The field
   *  is reserved for symmetry / future expansion. */
  defaultJiraProjectKey?: string | null;
}

/**
 * Detect-and-resolve. Identical to `detectTicket` plus support for
 * GitHub short refs when a default repo is provided. Used by the
 * server-side save path where we know the entry's project_id and
 * can look up the default repo.
 */
export function resolveTicketReference(
  description: string,
  options: ResolveOptions = {},
): DetectedTicket | null {
  // Try short form first when a default repo is configured. The
  // pattern is `#NNN` with a non-word boundary on the left so we
  // don't grab "#" out of an HTML color or the middle of a URL.
  const shortRepo = options.defaultGithubRepo?.trim();
  if (shortRepo) {
    // Don't fire if the description ALSO contains a long-form ref —
    // long form wins.
    const long = detectTicket(description);
    if (long) return long;

    const short = description.match(/(^|[^\w/])#(\d+)\b/);
    if (short) {
      return {
        provider: "github",
        key: `${shortRepo}#${short[2]}`,
        matchedText: `#${short[2]}`,
      };
    }
  }

  return detectTicket(description);
}

/** Build the canonical browser URL for a ticket. Used when the
 *  lookup hasn't run yet (offline / no creds) so the chip can still
 *  link out — better than a dead chip. */
export function ticketUrl(
  ticket: { provider: TicketProvider; key: string },
  context: { jiraBaseUrl?: string | null } = {},
): string | null {
  if (ticket.provider === "jira") {
    if (!context.jiraBaseUrl) return null;
    const trimmed = context.jiraBaseUrl.replace(/\/$/, "");
    return `${trimmed}/browse/${ticket.key}`;
  }
  // GitHub: key is always `owner/repo#NNN`
  const m = ticket.key.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}/issues/${m[3]}`;
}
