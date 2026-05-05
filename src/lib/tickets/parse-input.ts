/**
 * Parse a free-text ticket reference typed into a form field, given
 * the project's configured providers, into a fully-qualified ticket
 * key. Sibling to `resolveTicketReference` (which scans descriptions);
 * this one expects a tight, dedicated input.
 *
 * Accepted shapes:
 *   - Long-form GitHub:  `owner/repo#42`
 *   - Full Jira key:     `AE-640`  (case-insensitive — we uppercase)
 *   - GitHub short hash: `#42`     → repo from `defaultGithubRepo`
 *   - Bare number:       `42`      → resolves against the configured
 *                                    provider (Jira preferred when
 *                                    both are configured)
 *
 * `null` for unparseable input or an unconfigured provider — the form
 * surfaces that as a validation message.
 */

import type { DetectedTicket } from "./detect";

export interface ParseTicketInputOptions {
  defaultGithubRepo?: string | null;
  defaultJiraProjectKey?: string | null;
  /** When the user explicitly chose a provider (a both-configured
   *  project shows a small toggle), bare numbers resolve against
   *  this. When omitted, we prefer Jira → GitHub. */
  preferProvider?: "jira" | "github";
}

export function parseTicketInput(
  raw: string,
  options: ParseTicketInputOptions = {},
): DetectedTicket | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const { defaultGithubRepo, defaultJiraProjectKey, preferProvider } = options;

  // Long-form GitHub: owner/repo#42
  const ghLong = trimmed.match(
    /^([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)$/,
  );
  if (ghLong) {
    return {
      provider: "github",
      key: `${ghLong[1]}#${ghLong[2]}`,
      matchedText: trimmed,
    };
  }

  // Full Jira key (case-insensitive — we normalize to upper).
  const jiraFull = trimmed.match(/^([A-Za-z][A-Za-z0-9_]+)-(\d+)$/);
  if (jiraFull) {
    return {
      provider: "jira",
      key: `${jiraFull[1]!.toUpperCase()}-${jiraFull[2]}`,
      matchedText: trimmed,
    };
  }

  // GitHub short hash: #42 — needs a default repo.
  const hashShort = trimmed.match(/^#(\d+)$/);
  if (hashShort && defaultGithubRepo) {
    return {
      provider: "github",
      key: `${defaultGithubRepo}#${hashShort[1]}`,
      matchedText: trimmed,
    };
  }

  // Bare number — needs at least one default. Pick the preferred
  // provider, then Jira, then GitHub.
  const bareNumber = trimmed.match(/^(\d+)$/);
  if (bareNumber) {
    const number = bareNumber[1]!;
    if (preferProvider === "jira" && defaultJiraProjectKey) {
      return {
        provider: "jira",
        key: `${defaultJiraProjectKey}-${number}`,
        matchedText: trimmed,
      };
    }
    if (preferProvider === "github" && defaultGithubRepo) {
      return {
        provider: "github",
        key: `${defaultGithubRepo}#${number}`,
        matchedText: trimmed,
      };
    }
    if (defaultJiraProjectKey) {
      return {
        provider: "jira",
        key: `${defaultJiraProjectKey}-${number}`,
        matchedText: trimmed,
      };
    }
    if (defaultGithubRepo) {
      return {
        provider: "github",
        key: `${defaultGithubRepo}#${number}`,
        matchedText: trimmed,
      };
    }
  }

  return null;
}

/**
 * Render a ticket key back into the most user-friendly short form
 * for the given project. Inverse of `parseTicketInput`. Used to
 * pre-fill the form's text input from `linked_ticket_key` so the
 * user sees `640` instead of `AE-640` when their project is on Jira
 * key `AE`.
 */
export function formatTicketKeyForInput(
  ticket: { provider: "jira" | "github"; key: string },
  options: ParseTicketInputOptions = {},
): string {
  const { defaultGithubRepo, defaultJiraProjectKey } = options;

  if (ticket.provider === "jira") {
    const m = ticket.key.match(/^([A-Z][A-Z0-9_]+)-(\d+)$/);
    if (m && defaultJiraProjectKey === m[1]) return m[2]!;
    return ticket.key;
  }
  // github: owner/repo#NNN — strip repo when it matches the default
  const m = ticket.key.match(/^([^#]+)#(\d+)$/);
  if (m && defaultGithubRepo === m[1]) return `#${m[2]}`;
  return ticket.key;
}
