import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTicketReference, type DetectedTicket } from "./detect";
import { lookupTicket } from "./lookup";
import { parseTicketInput } from "./parse-input";

/** Fields written onto `time_entries` when a ticket is detected
 *  in a description. All five are NULL when nothing matched. */
export interface TicketAttachment {
  linked_ticket_provider: "jira" | "github" | null;
  linked_ticket_key: string | null;
  linked_ticket_url: string | null;
  linked_ticket_title: string | null;
  linked_ticket_refreshed_at: string | null;
}

const EMPTY: TicketAttachment = {
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
};

/**
 * Given a description (and optionally an explicit ticket reference
 * the user typed into a dedicated field) plus a project, return the
 * columns to write onto the time entry. Always succeeds — failure
 * modes (no input, no detection, no creds, lookup error) all collapse
 * to EMPTY so the caller never has to special-case them.
 *
 * Resolution order:
 *   1. `ticketRef` (explicit user input from the form) wins.
 *   2. Otherwise, scan the description for a Jira / GitHub reference.
 *
 * The project is loaded once for `github_repo` / `jira_project_key`
 * so short refs (`#123`, bare numbers) resolve against the project's
 * defaults.
 */
export async function buildTicketAttachment(
  supabase: SupabaseClient,
  userId: string,
  description: string | null,
  projectId: string | null,
  ticketRef?: string | null,
): Promise<TicketAttachment> {
  // Need at least one signal — explicit ref or description text.
  if (!ticketRef && !description) return EMPTY;

  // Load the project's default repo / Jira key for short-ref
  // resolution. Cheap query — single row by primary key.
  let defaultGithubRepo: string | null = null;
  let defaultJiraProjectKey: string | null = null;
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("github_repo, jira_project_key")
      .eq("id", projectId)
      .maybeSingle();
    defaultGithubRepo = (project?.github_repo as string | null) ?? null;
    defaultJiraProjectKey =
      (project?.jira_project_key as string | null) ?? null;
  }

  let detected: DetectedTicket | null = null;
  if (ticketRef && ticketRef.trim()) {
    detected = parseTicketInput(ticketRef, {
      defaultGithubRepo,
      defaultJiraProjectKey,
    });
  }
  if (!detected && description) {
    detected = resolveTicketReference(description, {
      defaultGithubRepo,
      defaultJiraProjectKey,
    });
  }
  if (!detected) return EMPTY;

  // Lookup may return null — no creds, 404, transient. We still
  // attach the key + provider so the chip renders, just without the
  // resolved title.
  const resolved = await lookupTicket(supabase, userId, detected);
  if (resolved) {
    return {
      linked_ticket_provider: resolved.provider,
      linked_ticket_key: resolved.key,
      linked_ticket_url: resolved.url,
      linked_ticket_title: resolved.title,
      linked_ticket_refreshed_at: new Date().toISOString(),
    };
  }

  // Detected but couldn't resolve. Fall back to a partial attachment
  // — the chip renders with the key, just no title. Refresh button
  // can retry once creds are configured.
  return {
    linked_ticket_provider: detected.provider,
    linked_ticket_key: detected.key,
    linked_ticket_url: null,
    linked_ticket_title: null,
    linked_ticket_refreshed_at: null,
  };
}
