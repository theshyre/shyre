import Sidebar from "@/components/Sidebar";
import { TimezoneSync } from "@/components/TimezoneSync";
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

  // Fetch unresolved error count for admin badge
  let unresolvedErrorCount = 0;
  if (admin) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null);
    unresolvedErrorCount = count ?? 0;
  }

  return (
    <div className="flex h-full">
      <TimezoneSync />
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
