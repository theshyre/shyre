import Sidebar from "@/components/Sidebar";
import { TimezoneSync } from "@/components/TimezoneSync";
import { ThemeSync } from "@/components/ThemeSync";
import { TextSizeSync } from "@/components/TextSizeSync";
import { ToastProvider } from "@/components/Toast";
import { GlobalKeyboardHelp } from "@/components/GlobalKeyboardHelp";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import type { TextSize } from "@/components/text-size-provider";
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

  // User's persisted theme + text size (null if never set — client falls back)
  const { data: userPrefs } = await supabase
    .from("user_settings")
    .select("preferred_theme, text_size")
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

  return (
    <ToastProvider>
      <div className="flex h-full">
        <TimezoneSync />
        <ThemeSync preferredTheme={preferredTheme} />
        <TextSizeSync preferredTextSize={preferredTextSize} />
        <Sidebar
          displayName={user.displayName}
          email={user.userEmail}
          avatarUrl={avatarUrl}
          userId={user.userId}
          isSystemAdmin={admin}
          unresolvedErrorCount={unresolvedErrorCount}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
        </main>
        <GlobalKeyboardHelp />
        <GlobalCommandPalette isSystemAdmin={admin} />
      </div>
    </ToastProvider>
  );
}
