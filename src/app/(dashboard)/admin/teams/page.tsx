import Link from "next/link";
import { requireSystemAdmin } from "@/lib/system-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Building2,
  Users,
  FolderKanban,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 50;
const MAX_PAGE = 200; // Hard ceiling against absurd page-jumping.

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function AdminOrganizationsPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const admin = createAdminClient();
  const sp = await searchParams;

  const rawPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, MAX_PAGE) : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Page of teams + total count.
  const { data: teams, count: totalOrgs } = await admin
    .from("teams")
    .select("id, name, slug, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const teamIds = (teams ?? []).map((o) => o.id);

  // Fan out counts only for the teams on this page — bounded work regardless
  // of how large the table grows.
  const countsPerOrg =
    teamIds.length === 0
      ? {
          members: new Map<string, number>(),
          customers: new Map<string, number>(),
          projects: new Map<string, number>(),
          entries: new Map<string, number>(),
          invoices: new Map<string, number>(),
        }
      : await fetchPagedCounts(admin, teamIds);

  const total = totalOrgs ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">All Teams</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-content-muted">
          {total} total
        </span>
      </div>

      <div className="mt-6 space-y-3">
        {(teams ?? []).map((org) => (
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
                count={countsPerOrg.members.get(org.id) ?? 0}
              />
              <StatCell
                icon={Users}
                label="Customers"
                count={countsPerOrg.customers.get(org.id) ?? 0}
              />
              <StatCell
                icon={FolderKanban}
                label="Projects"
                count={countsPerOrg.projects.get(org.id) ?? 0}
              />
              <StatCell
                icon={Clock}
                label="Time Entries"
                count={countsPerOrg.entries.get(org.id) ?? 0}
              />
              <StatCell
                icon={FileText}
                label="Invoices"
                count={countsPerOrg.invoices.get(org.id) ?? 0}
              />
            </div>
          </div>
        ))}

        {(!teams || teams.length === 0) && (
          <p className="text-sm text-content-muted">No teams on this page.</p>
        )}
      </div>

      {totalPages > 1 && (
        <nav
          className="mt-6 flex items-center justify-between gap-3 text-sm"
          aria-label="Pagination"
        >
          <PageLink page={page - 1} enabled={hasPrev} label="Previous">
            <ChevronLeft size={14} />
            Previous
          </PageLink>
          <span className="text-content-muted">
            Page <span className="text-content font-semibold">{page}</span> of{" "}
            <span className="text-content font-semibold">{totalPages}</span>
          </span>
          <PageLink page={page + 1} enabled={hasNext} label="Next">
            Next
            <ChevronRight size={14} />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

async function fetchPagedCounts(
  admin: ReturnType<typeof createAdminClient>,
  teamIds: string[],
): Promise<{
  members: Map<string, number>;
  customers: Map<string, number>;
  projects: Map<string, number>;
  entries: Map<string, number>;
  invoices: Map<string, number>;
}> {
  // Each query below is scoped to the page's teamIds, so the result set is
  // bounded by (PAGE_SIZE × rows-per-org) — not a full table scan.
  const [members, customers, projects, entries, invoices] = await Promise.all([
    admin.from("team_members").select("team_id").in("team_id", teamIds),
    admin.from("customers").select("team_id").in("team_id", teamIds),
    admin.from("projects").select("team_id").in("team_id", teamIds),
    admin.from("time_entries").select("team_id").in("team_id", teamIds),
    admin.from("invoices").select("team_id").in("team_id", teamIds),
  ]);
  return {
    members: countByOrg(members.data),
    customers: countByOrg(customers.data),
    projects: countByOrg(projects.data),
    entries: countByOrg(entries.data),
    invoices: countByOrg(invoices.data),
  };
}

function countByOrg(
  data: { team_id: string }[] | null,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.team_id, (map.get(row.team_id) ?? 0) + 1);
  }
  return map;
}

function PageLink({
  page,
  enabled,
  label,
  children,
}: {
  page: number;
  enabled: boolean;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-inset px-3 py-1.5 text-content-muted opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={`/admin/teams?page=${page}`}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-raised px-3 py-1.5 text-content-secondary hover:bg-hover hover:text-content transition-colors"
    >
      {children}
    </Link>
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
