import type { Metadata } from "next";
import { requireSystemAdmin } from "@/lib/system-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { Users, Crown } from "lucide-react";
import { formatDate } from "@theshyre/ui";
import { tableClass } from "@/lib/table-styles";

export const metadata: Metadata = { title: "Admin · Users" };

export default async function AdminUsersPage(): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const admin = createAdminClient();

  // List all users via admin API
  const { data: authData } = await admin.auth.admin.listUsers();
  const users = authData?.users ?? [];

  // Get system admin list
  const { data: sysAdmins } = await admin
    .from("system_admins")
    .select("user_id");
  const sysAdminIds = new Set((sysAdmins ?? []).map((s) => s.user_id));

  // Get profiles
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, display_name");
  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.user_id, p.display_name])
  );

  // Get org memberships count per user
  const { data: memberships } = await admin
    .from("team_members")
    .select("user_id");
  const teamCountByUser = new Map<string, number>();
  for (const m of memberships ?? []) {
    teamCountByUser.set(m.user_id, (teamCountByUser.get(m.user_id) ?? 0) + 1);
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">All Users</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-caption font-medium text-content-muted">
          {users.length} total
        </span>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
        <table className={tableClass}>
          <thead>
            <tr className="border-b border-edge bg-surface-inset">
              <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                User
              </th>
              <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                Email
              </th>
              <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                Role
              </th>
              <th className="px-4 py-3 text-right text-caption font-semibold uppercase tracking-wider text-content-muted">
                Orgs
              </th>
              <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                Joined
              </th>
              <th className="px-4 py-3 text-left text-caption font-semibold uppercase tracking-wider text-content-muted">
                Last Sign In
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const displayName = profileMap.get(u.id) ?? u.email?.split("@")[0] ?? "";
              const isSystemAdmin = sysAdminIds.has(u.id);
              const teamCount = teamCountByUser.get(u.id) ?? 0;

              return (
                <tr
                  key={u.id}
                  className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-accent-text text-caption font-semibold">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-content">
                        {displayName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-content-secondary font-mono text-caption">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    {isSystemAdmin ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning-text">
                        <Crown size={10} />
                        System Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2 py-0.5 text-caption text-content-muted">
                        User
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-content-secondary">
                    {teamCount}
                  </td>
                  <td className="px-4 py-3 text-content-muted text-caption">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-content-muted text-caption">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleString()
                      : "Never"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
