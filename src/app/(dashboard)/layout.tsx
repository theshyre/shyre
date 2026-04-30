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
import type { TextSize } from "@/components/text-size-provider";
import type { TableDensity } from "@/components/table-density-provider";
import { getUserContext } from "@/lib/team-context";
import { isSystemAdmin } from "@/lib/system-admin";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const user = await getUserContext();
  const admin = await isSystemAdmin();
  const supabase = await createClient();

  // User's persisted theme + text size + table density (null if never
  // set — client falls back to localStorage / built-in default)
  const { data: userPrefs } = await supabase
    .from("user_settings")
    .select("preferred_theme, text_size, table_density")
    .eq("user_id", user.userId)
    .maybeSingle();
  const preferredTheme =
    (userPrefs?.preferred_theme as
      | "system"
      | "light"
      | "dark"
      | "high-contrast"
      | "warm"
      | null
      | undefined) ?? null;
  const preferredTextSize =
    (userPrefs?.text_size as TextSize | null | undefined) ?? null;
  const preferredDensity =
    (userPrefs?.table_density as TableDensity | null | undefined) ?? null;

  // Avatar for the sidebar user-identity block
  const { data: profileRow } = await supabase
    .from("user_profiles")
    .select("avatar_url")
    .eq("user_id", user.userId)
    .maybeSingle();
  const avatarUrl = profileRow?.avatar_url ?? null;

  // Fetch unresolved error count for admin badge
  let unresolvedErrorCount = 0;
  if (admin) {
    const { count } = await supabase
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null);
    unresolvedErrorCount = count ?? 0;
  }

  // Whether to render the Business sidebar item. Owner|admin role on
  // a team in any business → can manage that business. Members and
  // contributors don't see the entry, matching the tightened
  // bp_select RLS policy on business_people (HR data).
  const { data: ownerAdminTeams } = await supabase
    .from("team_members")
    .select("role")
    .eq("user_id", user.userId)
    .in("role", ["owner", "admin"])
    .limit(1);
  const canManageBusiness = (ownerAdminTeams ?? []).length > 0;

  // Ambient team-context chip in the sidebar bottom block. Shows
  // the user's single team name when teams.length === 1, the team
  // count otherwise. Both link to /teams; without a global
  // active-team concept (every page reads ?org= individually),
  // this is informational rather than a switcher — the chip
  // confirms scope; the user toggles via TeamFilter on each list
  // page when they need to.
  const { data: teamMemberships } = await supabase
    .from("team_members")
    .select("teams(id, name)")
    .eq("user_id", user.userId);
  const memberTeams = (teamMemberships ?? [])
    .map((row) => {
      const t = row.teams as { id: string; name: string } | { id: string; name: string }[] | null;
      return Array.isArray(t) ? (t[0] ?? null) : t;
    })
    .filter((t): t is { id: string; name: string } => t !== null);
  const teamCount = memberTeams.length;
  const primaryTeamName =
    teamCount === 1 ? (memberTeams[0]?.name ?? null) : null;

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
