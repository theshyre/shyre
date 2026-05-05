import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Centralized credential-expiration scan.
 *
 * Aggregates rotate-by dates across every credential Shyre stores
 * (instance-level Vercel API token, team-level Resend API key,
 * user-level GitHub PAT and Jira API token) and returns them in a
 * single normalized list. Powers the dashboard banner, the
 * /system/credentials index, and (Phase 2) the cron-driven email
 * reminders.
 *
 * Each surface that wants reminders calls `scanCredentials()` and
 * filters / sorts the result. There's only one source of truth
 * for "what's about to expire" so banner copy + email copy stay
 * in sync.
 */

export type CredentialKind =
  | "vercel_api_token"
  | "resend_api_key"
  | "github_token"
  | "jira_api_token";

/** ok > warning > critical > expired. Banner color + sort order
 *  derive from this. */
export type Severity = "ok" | "warning" | "critical" | "expired";

export interface CredentialItem {
  kind: CredentialKind;
  /** Human-friendly label for UI ("Vercel API token", "Resend API
   *  key — Malcom IO"). For team / user scoped credentials, the
   *  scope context (team name, user display name) is included. */
  label: string;
  scope: "instance" | "team" | "user";
  /** scope-id, when applicable. Null for instance-scoped. */
  scopeId: string | null;
  /** ISO date (YYYY-MM-DD) the credential expires. Null when the
   *  user hasn't set a rotate-by date — those don't show in the
   *  banner but DO show in /system/credentials so the admin can
   *  notice the gap. */
  expiresAt: string | null;
  /** Whole days from today to expiresAt. Negative = expired. Null
   *  when expiresAt is null. */
  daysUntilExpiry: number | null;
  severity: Severity;
  /** Where the user clicks to rotate. Anchored at the field that
   *  needs editing. */
  editUrl: string;
}

/** Returns every credential Shyre tracks, sorted by severity then
 *  daysUntilExpiry. Caller decides what to render — banner uses
 *  only `severity in {expired, critical, warning}`; system page
 *  shows everything. */
export async function scanCredentials(
  supabase: SupabaseClient,
): Promise<CredentialItem[]> {
  const today = startOfTodayUtc();

  const [vercelRows, resendRows, githubRows, jiraRows] = await Promise.all([
    // Instance-level Vercel token. Single-row table; system-admin
    // RLS gates it. A non-admin caller gets [] from RLS and the
    // banner just hides — that's correct: a member doesn't need
    // to know whether the Vercel token is about to expire.
    supabase
      .from("instance_deploy_config")
      .select("api_token, api_token_expires_at")
      .eq("id", 1)
      .maybeSingle(),
    // Team-level Resend keys. Owner / admin RLS already scopes
    // this to teams the caller can act on.
    supabase
      .from("team_email_config")
      .select("team_id, api_key_encrypted, api_key_expires_at, teams(name)"),
    // User-level GitHub token. Each user reads only their own
    // user_settings via existing RLS. We only need presence —
    // `has_github_token` is a generated column so the secret bytes
    // never leave Postgres for this query (defense-in-depth: a
    // future error-capture surface that snapshots row data can't
    // see the token).
    supabase
      .from("user_settings")
      .select("user_id, github_token_expires_at, has_github_token"),
    // User-level Jira token. Same presence-only rule.
    supabase
      .from("user_settings")
      .select("user_id, jira_api_token_expires_at, has_jira_api_token"),
  ]);

  const items: CredentialItem[] = [];

  // Vercel
  const vercel = vercelRows.data as
    | { api_token: string | null; api_token_expires_at: string | null }
    | null;
  if (vercel?.api_token) {
    items.push(
      buildItem({
        kind: "vercel_api_token",
        label: "Vercel API token",
        scope: "instance",
        scopeId: null,
        expiresAt: vercel.api_token_expires_at,
        editUrl: "/system/deploy",
        today,
      }),
    );
  }

  // Resend (per team)
  const resends = (resendRows.data ?? []) as Array<{
    team_id: string;
    api_key_encrypted: unknown;
    api_key_expires_at: string | null;
    teams: { name: string | null } | { name: string | null }[] | null;
  }>;
  for (const r of resends) {
    if (!r.api_key_encrypted) continue;
    const teamName = teamNameFrom(r.teams);
    items.push(
      buildItem({
        kind: "resend_api_key",
        label: teamName
          ? `Resend API key — ${teamName}`
          : "Resend API key",
        scope: "team",
        scopeId: r.team_id,
        expiresAt: r.api_key_expires_at,
        editUrl: `/teams/${r.team_id}/email#config`,
        today,
      }),
    );
  }

  // GitHub (own row only — RLS already enforces)
  const githubs = (githubRows.data ?? []) as Array<{
    user_id: string;
    has_github_token: boolean | null;
    github_token_expires_at: string | null;
  }>;
  for (const g of githubs) {
    if (!g.has_github_token) continue;
    items.push(
      buildItem({
        kind: "github_token",
        label: "GitHub personal access token",
        scope: "user",
        scopeId: g.user_id,
        expiresAt: g.github_token_expires_at,
        editUrl: "/profile",
        today,
      }),
    );
  }

  // Jira (same shape as GitHub)
  const jiras = (jiraRows.data ?? []) as Array<{
    user_id: string;
    has_jira_api_token: boolean | null;
    jira_api_token_expires_at: string | null;
  }>;
  for (const j of jiras) {
    if (!j.has_jira_api_token) continue;
    items.push(
      buildItem({
        kind: "jira_api_token",
        label: "Jira API token",
        scope: "user",
        scopeId: j.user_id,
        expiresAt: j.jira_api_token_expires_at,
        editUrl: "/profile",
        today,
      }),
    );
  }

  return items.sort(sortItems);
}

function buildItem(input: {
  kind: CredentialKind;
  label: string;
  scope: CredentialItem["scope"];
  scopeId: string | null;
  expiresAt: string | null;
  editUrl: string;
  today: Date;
}): CredentialItem {
  const days = input.expiresAt
    ? daysBetween(input.today, parseDateOnly(input.expiresAt))
    : null;
  return {
    kind: input.kind,
    label: input.label,
    scope: input.scope,
    scopeId: input.scopeId,
    expiresAt: input.expiresAt,
    daysUntilExpiry: days,
    severity: severityFor(days),
    editUrl: input.editUrl,
  };
}

function severityFor(daysUntilExpiry: number | null): Severity {
  if (daysUntilExpiry == null) return "ok";
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= 7) return "critical";
  if (daysUntilExpiry <= 30) return "warning";
  return "ok";
}

const SEVERITY_ORDER: Record<Severity, number> = {
  expired: 0,
  critical: 1,
  warning: 2,
  ok: 3,
};

function sortItems(a: CredentialItem, b: CredentialItem): number {
  const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sev !== 0) return sev;
  // Within the same severity, soonest-expiring first.
  const ad = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
  const bd = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
  return ad - bd;
}

/** Today as a UTC midnight Date — the calendar-day reference for
 *  daysUntilExpiry. Using UTC avoids the negative-offset gotcha
 *  where an expires_at=2026-05-04 stored as a DATE renders as
 *  2026-05-03 in PST. */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function parseDateOnly(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return new Date(iso);
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000);
}

function teamNameFrom(
  teams: { name: string | null } | { name: string | null }[] | null,
): string | null {
  if (!teams) return null;
  if (Array.isArray(teams)) return teams[0]?.name ?? null;
  return teams.name ?? null;
}
