import Sidebar from "@/components/Sidebar";
import { TimezoneSync } from "@/components/TimezoneSync";
import { ThemeSync } from "@/components/ThemeSync";
import { getUserContext } from "@/lib/org-context";
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

  // User's persisted theme (null if they've never set it — fall back to system)
  const { data: userPrefs } = await supabase
    .from("user_settings")
    .select("preferred_theme")
    .eq("user_id", user.userId)
    .maybeSingle();
  const preferredTheme =
    (userPrefs?.preferred_theme as
      | "system"
      | "light"
      | "dark"
      | "high-contrast"
      | null
      | undefined) ?? null;

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
    <div className="flex h-full">
      <TimezoneSync />
      <ThemeSync preferredTheme={preferredTheme} />
      <Sidebar
        displayName={user.displayName}
        email={user.userEmail}
        isSystemAdmin={admin}
        unresolvedErrorCount={unresolvedErrorCount}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
