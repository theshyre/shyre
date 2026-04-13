import { createClient } from "@/lib/supabase/server";
import { LayoutDashboard } from "lucide-react";

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      <div className="flex items-center gap-3">
        <LayoutDashboard size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">Dashboard</h1>
      </div>
      <p className="mt-2 text-content-secondary">
        Welcome back, {user?.email}
      </p>
      <p className="mt-4 text-sm text-content-muted">
        Start by adding your first client in the Clients section.
      </p>
    </div>
  );
}
