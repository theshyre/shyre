/**
 * Jira REST API helpers.
 *
 * Atlassian's Cloud auth model: Basic auth using
 *   username = user's email, password = an API token minted at
 *   id.atlassian.com/manage-profile/security/api-tokens.
 *
 * Tokens are personal — they inherit the user's permissions.
 * Storing them per-user (user_settings.jira_api_token) matches
 * that model.
 *
 * SSRF protection: every outbound URL passes through
 * `assertSafeOutboundUrl` (SAL-014). The user-supplied base URL
 * is validated for private-IP / loopback / link-local before any
 * fetch fires, and `redirect: "manual"` blocks redirect-based
 * bypasses. Self-hosted Jira (non-atlassian.net) is supported but
 * still subject to the IP-range guard.
 */

import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from "./url-safety";

interface JiraApiError {
  message: string;
  status: number;
}

export interface JiraIssue {
  /** "PROJ-123" */
  key: string;
  /** "Fix login bug" — pulled from fields.summary */
  summary: string;
  /** Browser URL: <baseUrl>/browse/<key> */
  browseUrl: string;
}

export interface JiraCreds {
  baseUrl: string;
  email: string;
  apiToken: string;
}

function authHeader(creds: JiraCreds): string {
  return (
    "Basic " +
    Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")
  );
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

/** Fetch a single Jira issue by key. Returns the summary + a
 *  pre-built browse URL so callers don't need to know the base. */
export async function fetchJiraIssue(
  key: string,
  creds: JiraCreds,
): Promise<{ data: JiraIssue | null; error: JiraApiError | null }> {
  const base = trimBase(creds.baseUrl);
  // `fields=summary` keeps the response tiny — Jira issues can be
  // multi-MB if we ask for the default field set.
  const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary`;

  try {
    await assertSafeOutboundUrl(url);
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(creds),
        Accept: "application/json",
      },
      redirect: "manual",
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return {
        data: null,
        error: { message: res.statusText, status: res.status },
      };
    }

    const json = (await res.json()) as {
      key?: string;
      fields?: { summary?: string };
    };
    const issueKey = json.key ?? key;
    const summary = json.fields?.summary ?? "";

    return {
      data: {
        key: issueKey,
        summary,
        browseUrl: `${base}/browse/${issueKey}`,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      return {
        data: null,
        error: { message: `Blocked: ${err.message}`, status: 0 },
      };
    }
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Unknown error",
        status: 0,
      },
    };
  }
}

/** Validate creds by hitting `/myself`. Used by the settings
 *  page's Test connection button. */
export async function validateJiraCreds(
  creds: JiraCreds,
): Promise<{ ok: boolean; error: JiraApiError | null }> {
  const base = trimBase(creds.baseUrl);
  const url = `${base}/rest/api/3/myself`;
  try {
    await assertSafeOutboundUrl(url);
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(creds),
        Accept: "application/json",
      },
      redirect: "manual",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: { message: res.statusText, status: res.status },
      };
    }
    return { ok: true, error: null };
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      return {
        ok: false,
        error: { message: `Blocked: ${err.message}`, status: 0 },
      };
    }
    return {
      ok: false,
      error: {
        message: err instanceof Error ? err.message : "Unknown error",
        status: 0,
      },
    };
  }
}
