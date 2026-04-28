import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { fetchSingleIssue } from "@/lib/github";
import { fetchJiraIssue, type JiraCreds } from "@/lib/jira";
import type { DetectedTicket, TicketProvider } from "./detect";

export interface ResolvedTicket {
  provider: TicketProvider;
  key: string;
  url: string;
  title: string;
}

interface UserCreds {
  githubToken: string | null;
  jira: JiraCreds | null;
}

/** Fetch the caller's GitHub + Jira credentials in one round trip.
 *  Both can be null — callers must handle the missing-credential
 *  case (return null from lookup, save entry without title). */
async function loadCreds(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserCreds> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("github_token, jira_base_url, jira_email, jira_api_token")
    .eq("user_id", userId)
    .maybeSingle();

  const githubToken = (settings?.github_token as string | null) ?? null;
  const jira: JiraCreds | null =
    settings?.jira_base_url && settings?.jira_email && settings?.jira_api_token
      ? {
          baseUrl: settings.jira_base_url as string,
          email: settings.jira_email as string,
          apiToken: settings.jira_api_token as string,
        }
      : null;

  return { githubToken, jira };
}

/**
 * Resolve a detected ticket to its title + canonical URL. Fail-safe:
 * any error path (no creds, 404, network) returns null and logs via
 * logError so the time-entry save doesn't block on a transient
 * upstream issue.
 *
 * The userId argument is the user whose tokens we should use — this
 * is always `auth.uid()` of the caller; the lookup never uses
 * another member's token.
 */
export async function lookupTicket(
  supabase: SupabaseClient,
  userId: string,
  ticket: DetectedTicket,
): Promise<ResolvedTicket | null> {
  const creds = await loadCreds(supabase, userId);

  if (ticket.provider === "github") {
    if (!creds.githubToken) return null;

    const m = ticket.key.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!m) return null;
    const repo = `${m[1]}/${m[2]}`;
    const number = Number(m[3]);

    const { data, error } = await fetchSingleIssue(
      repo,
      number,
      creds.githubToken,
    );
    if (error || !data) {
      if (error && error.status !== 404 && error.status !== 0) {
        // 404 is the normal "wrong number, dead repo" case — not
        // worth a log entry. 0 is our wrapper's network-error code,
        // also chatty. Anything else is a real signal.
        logError(
          new Error(`GitHub lookup failed: ${error.message}`),
          { userId, action: "lookupTicket.github" },
        );
      }
      return null;
    }
    return {
      provider: "github",
      key: ticket.key,
      url: data.html_url,
      title: data.title,
    };
  }

  // Jira
  if (!creds.jira) return null;
  const { data, error } = await fetchJiraIssue(ticket.key, creds.jira);
  if (error || !data) {
    if (error && error.status !== 404 && error.status !== 0) {
      logError(
        new Error(`Jira lookup failed: ${error.message}`),
        { userId, action: "lookupTicket.jira" },
      );
    }
    return null;
  }
  return {
    provider: "jira",
    key: data.key,
    url: data.browseUrl,
    title: data.summary,
  };
}
