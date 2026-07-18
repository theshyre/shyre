import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plug, KeyRound, Building2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserContext, getUserTeams } from "@/lib/team-context";
import { isTeamAdmin } from "@/lib/team-roles";
import { logError } from "@/lib/logger";
import { ALLOWED_API_SCOPES } from "@/lib/integrations/allow-lists";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { KillSwitchCard } from "./kill-switch-card";
import { NewTokenForm } from "./new-token-form";
import { TokenList } from "./token-list";
import { ActivityList } from "./activity-list";
import { SetupHelp } from "./setup-help";
import type {
  IntegrationEventRow,
  IntegrationTokenRow,
  TokenOwnerProfile,
} from "./token-constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("title") };
}

/**
 * /settings/integrations — token management for the external-API
 * surface (SAL-051 P1).
 *
 * Reads are all plain RLS-scoped selects:
 *   - a member sees their own tokens + events;
 *   - a team owner/admin additionally sees every member's tokens and
 *     the whole team's events (the policies grant it — no extra app
 *     logic needed, the same query returns more rows).
 *
 * SECURITY: no query on this surface may select `token_hash`
 * (`no-token-hash-select.test.ts` enforces at the source level).
 */
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}): Promise<React.JSX.Element> {
  const [{ userId }, teams, t, params] = await Promise.all([
    getUserContext(),
    getUserTeams(),
    getTranslations("integrations"),
    searchParams,
  ]);

  const header = (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Plug size={24} className="text-accent" aria-hidden="true" />
        <h1 className="text-page-title font-bold text-content">
          {t("title")}
        </h1>
      </div>
      <p className="max-w-2xl text-body text-content-secondary">
        {t("description")}
      </p>
    </div>
  );

  if (teams.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <p className="rounded-lg border border-edge bg-surface-raised p-4 text-body text-content-muted">
          {t("noTeam")}
        </p>
      </div>
    );
  }

  const activeTeam = teams.find((team) => team.id === params.team) ?? teams[0]!;
  const admin = isTeamAdmin(activeTeam.role);

  const supabase = await createClient();

  const [settingsRes, tokensRes, eventsRes] = await Promise.all([
    supabase
      .from("team_settings_v")
      .select("integrations_enabled")
      .eq("team_id", activeTeam.id)
      .maybeSingle(),
    supabase
      .from("integration_tokens")
      .select(
        "id, user_id, team_id, name, token_prefix, scopes, default_billable, created_at, expires_at, last_used_at, revoked_at",
      )
      .eq("team_id", activeTeam.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("integration_events")
      .select("id, action, status, occurred_at, user_id")
      .eq("team_id", activeTeam.id)
      .order("occurred_at", { ascending: false })
      .limit(20),
  ]);

  // PostgREST fails silently on malformed queries — always destructure
  // the error and log it (the projects(invoice_number) incident).
  const loadFailed = Boolean(
    settingsRes.error || tokensRes.error || eventsRes.error,
  );
  for (const res of [settingsRes, tokensRes, eventsRes]) {
    if (res.error) {
      logError(res.error, {
        userId,
        teamId: activeTeam.id,
        action: "IntegrationsSettingsPage",
      });
    }
  }

  // No team_settings row yet → the kill switch has never been turned
  // on → disabled (default-closed).
  const enabled = Boolean(
    (settingsRes.data as { integrations_enabled: boolean } | null)
      ?.integrations_enabled,
  );
  const tokens = (tokensRes.data ?? []) as IntegrationTokenRow[];
  const events = (eventsRes.data ?? []) as IntegrationEventRow[];

  // Authorship: fetch display names + avatars for everyone whose
  // tokens/events are visible (viewer included).
  const profileUserIds = Array.from(
    new Set([
      ...tokens.map((token) => token.user_id),
      ...events.map((event) => event.user_id),
    ]),
  );
  let profiles: TokenOwnerProfile[] = [];
  if (profileUserIds.length > 0) {
    const profilesRes = await supabase
      .from("user_profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", profileUserIds);
    if (profilesRes.error) {
      logError(profilesRes.error, {
        userId,
        teamId: activeTeam.id,
        action: "IntegrationsSettingsPage",
      });
    }
    profiles = (profilesRes.data ?? []) as TokenOwnerProfile[];
  }

  return (
    <div className="space-y-6">
      {header}

      {/* Team context is never hidden — single-team users get a static
          pill (the TeamFilter precedent); multi-team users get pill
          links. Deliberate fork from TeamFilter's dropdown: this page
          needs exactly one team (no "All" semantics), so it uses
          ?team= links, echoing the filter's Building2 icon. Selected
          state is icon + color (≥2 channels). */}
      <nav
        aria-label={t("teamPicker.label")}
        className="flex flex-wrap items-center gap-2"
      >
        <span className="inline-flex items-center gap-1.5 text-caption font-medium text-content-muted">
          <Building2 size={14} aria-hidden="true" />
          {t("teamPicker.label")}:
        </span>
        {teams.length === 1 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-raised px-3 py-1 text-caption font-medium text-content-secondary">
            {activeTeam.name}
          </span>
        ) : (
          teams.map((team) => {
            const active = team.id === activeTeam.id;
            return (
              <Link
                key={team.id}
                href={`/settings/integrations?team=${team.id}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-medium transition-colors ${
                  active
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-edge bg-surface-raised text-content-secondary hover:bg-hover"
                }`}
              >
                {active && <Check size={12} aria-hidden="true" />}
                {team.name}
                <LinkPendingSpinner />
              </Link>
            );
          })
        )}
      </nav>

      {loadFailed && (
        <p
          role="alert"
          className="rounded-lg border border-error/30 bg-error-soft p-3 text-body text-error-text"
        >
          {t("loadFailed")}
        </p>
      )}

      <KillSwitchCard
        teamId={activeTeam.id}
        enabled={enabled}
        isAdmin={admin}
      />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-accent" aria-hidden="true" />
          <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("tokens.heading")}
          </h2>
        </div>
        {enabled && (
          <NewTokenForm
            teamId={activeTeam.id}
            scopes={Array.from(ALLOWED_API_SCOPES)}
          />
        )}
        <TokenList
          tokens={tokens}
          profiles={profiles}
          currentUserId={userId}
          now={new Date().getTime()}
        />
      </section>

      <ActivityList events={events} profiles={profiles} />

      <SetupHelp />
    </div>
  );
}
