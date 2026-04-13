import { requireSystemAdmin } from "@/lib/system-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { Building2, Users, FolderKanban, Clock, FileText } from "lucide-react";

export default async function AdminOrganizationsPage(): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const admin = createAdminClient();

  // List all orgs
  const { data: orgs } = await admin
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });

  // Get counts per org
  const [memberCounts, clientCounts, projectCounts, timeEntryCounts, invoiceCounts] =
    await Promise.all([
      admin.from("organization_members").select("organization_id"),
      admin.from("clients").select("organization_id"),
      admin.from("projects").select("organization_id"),
      admin.from("time_entries").select("organization_id"),
      admin.from("invoices").select("organization_id"),
    ]);

  function countByOrg(data: { organization_id: string }[] | null): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of data ?? []) {
      map.set(row.organization_id, (map.get(row.organization_id) ?? 0) + 1);
    }
    return map;
  }

  const memberMap = countByOrg(memberCounts.data);
  const clientMap = countByOrg(clientCounts.data);
  const projectMap = countByOrg(projectCounts.data);
  const timeEntryMap = countByOrg(timeEntryCounts.data);
  const invoiceMap = countByOrg(invoiceCounts.data);

  return (
    <div>
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">All Organizations</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-content-muted">
          {orgs?.length ?? 0} total
        </span>
      </div>

      <div className="mt-6 space-y-3">
        {(orgs ?? []).map((org) => (
          <div
            key={org.id}
            className="rounded-lg border border-edge bg-surface-raised p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft">
                  <Building2 size={20} className="text-accent" />
                </div>
                <div>
                  <p className="font-semibold text-content">{org.name}</p>
                  <p className="text-xs text-content-muted font-mono">
                    {org.slug}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-content-muted">Created</p>
                <p className="text-xs text-content-secondary">
                  {new Date(org.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-3 text-xs">
              <StatCell
                icon={Users}
                label="Members"
                count={memberMap.get(org.id) ?? 0}
              />
              <StatCell
                icon={Users}
                label="Clients"
                count={clientMap.get(org.id) ?? 0}
              />
              <StatCell
                icon={FolderKanban}
                label="Projects"
                count={projectMap.get(org.id) ?? 0}
              />
              <StatCell
                icon={Clock}
                label="Time Entries"
                count={timeEntryMap.get(org.id) ?? 0}
              />
              <StatCell
                icon={FileText}
                label="Invoices"
                count={invoiceMap.get(org.id) ?? 0}
              />
            </div>
          </div>
        ))}

        {(!orgs || orgs.length === 0) && (
          <p className="text-sm text-content-muted">No organizations yet.</p>
        )}
      </div>
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof Users;
  label: string;
  count: number;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-surface p-2">
      <div className="flex items-center gap-1 text-content-muted mb-1">
        <Icon size={10} />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold font-mono text-content">{count}</p>
    </div>
  );
}
