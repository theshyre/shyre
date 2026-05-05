import Sidebar from "@/components/Sidebar";
import { TimezoneSync } from "@/components/TimezoneSync";
import { ThemeSync } from "@/components/ThemeSync";
import { TextSizeSync } from "@/components/TextSizeSync";
import { TableDensityProvider } from "@/components/table-density-provider";
import { TableDensitySync } from "@/components/TableDensitySync";
import { ToastProvider } from "@/components/Toast";
import { GlobalKeyboardHelp } from "@/components/GlobalKeyboardHelp";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { RunningTimerHeaderPill } from "@/components/RunningTimerHeaderPill";
import { SkipLink } from "@/components/SkipLink";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getUserContext, getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { isSystemAdmin } from "@/lib/system-admin";
import { getUserSettings } from "@/lib/user-settings";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  // Pre-2026-05-04 this layout had ~7 serial round-trips that ran on
  // every dashboard route — getUserContext, isSystemAdmin, two
  // user_settings/user_profiles fetches, and two team_members
  // fetches — adding ~600ms of fixed tax to every TTFB. Restructure
  // into a single Promise.all on cached helpers. The cached
  // helpers (getUserContext, getUserTeams, isSystemAdmin,
  // getUserSettings, createClient) all wrap React `cache()` so the
  // child page's repeat calls are free; only one auth.getUser
  // round-trip fires per request even though four helpers each
  // appear to do their own.
  const [user, teams, admin, settings] = await Promise.all([
    getUserContext(),
    getUserTeams(),
    isSystemAdmin(),
    getUserSettings(),
  ]);

  const preferredTheme = settings.preferredTheme;
  const preferredTextSize = settings.preferredTextSize;
  const preferredDensity = settings.preferredDensity;
  const avatarUrl = user.avatarUrl;

  // Fetch unresolved error count for admin badge. Conditional on
  // admin so non-admins don't pay the round-trip; admins eat one
  // sequential trip after the parallel block resolves.
  let unresolvedErrorCount = 0;
  if (admin) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null);
    unresolvedErrorCount = count ?? 0;
  }

  // Whether to render the Business sidebar item. Owner|admin role on
  // a team in any business → can manage that business. Derived from
  // the cached `teams` list (no extra round-trip) — the previous
  // separate `team_members.in("role", ["owner", "admin"]).limit(1)`
  // query is gone.
  const canManageBusiness = teams.some((t) => isTeamAdmin(t.role));

  // Ambient team-context chip in the sidebar bottom block. Shows
  // the user's single team name when teams.length === 1, the team
  // count otherwise. Both link to /teams; without a global
  // active-team concept (every page reads ?org= individually),
  // this is informational rather than a switcher.
  const teamCount = teams.length;
  const primaryTeamName = teamCount === 1 ? (teams[0]?.name ?? null) : null;

  return (
    <ToastProvider>
      <TableDensityProvider>
        {/* Skip link MUST be the first focusable element so a keyboard
            user pressing Tab on page load lands on it before the
            sidebar's ~15 nav entries. Visually hidden until focused. */}
        <SkipLink targetId="main-content" />
        <div className="flex h-full">
          <TimezoneSync />
          <ThemeSync preferredTheme={preferredTheme} />
          <TextSizeSync preferredTextSize={preferredTextSize} />
          <TableDensitySync preferredDensity={preferredDensity} />
          <Sidebar
            displayName={user.displayName}
            email={user.userEmail}
            avatarUrl={avatarUrl}
            userId={user.userId}
            isSystemAdmin={admin}
            unresolvedErrorCount={unresolvedErrorCount}
            canManageBusiness={canManageBusiness}
            teamCount={teamCount}
            primaryTeamName={primaryTeamName}
          />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto focus:outline-none"
          >
            <RunningTimerHeaderPill />
            <div className="mx-auto max-w-[1280px] px-[32px] py-8">
              <Breadcrumbs />
              {children}
            </div>
          </main>
          <GlobalKeyboardHelp />
          <GlobalCommandPalette isSystemAdmin={admin} />
        </div>
      </TableDensityProvider>
    </ToastProvider>
  );
}
