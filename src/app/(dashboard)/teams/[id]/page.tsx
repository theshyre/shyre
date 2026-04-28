import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess, getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: team } = await supabase
    .from("teams")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: (team?.name as string | undefined) ?? "Team" };
}
import {
  Building2,
  Users,
  FolderKanban,
  ArrowRight,
} from "lucide-react";
import { TeamSettingsForm } from "./team-settings-form";
import { TeamSection } from "./team-section";
import { RelationshipsSection } from "./relationships-section";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { userId, role } = await validateTeamAccess(id);

  const { data: org } = await supabase
    .from("teams")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  const { data: teamSettings } = await supabase
    .from("team_settings_v")
    .select("*")
    .eq("team_id", id)
    .single();

  // Fetch all members, then sort client-side: owner first, then admins,
  // then plain members, with joined_at breaking ties. This guarantees
  // the owner is always at the top of the list — important both for
  // visibility now and as a prerequisite for any future transfer-
  // ownership action (which would pick from this same list).
  // Two-step fetch: team_members has no FK to user_profiles (both go
  // through auth.users), so PostgREST can't embed the profile join.
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at")
    .eq("team_id", id);
  const memberUserIds = (rawMembers ?? []).map((m) => m.user_id as string);
  const { data: profileRows } = memberUserIds.length > 0
    ? await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", memberUserIds)
    : { data: [] };
  const displayNameByUserId = new Map<string, string | null>(
    (profileRows ?? []).map((p) => [
      p.user_id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );
  const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const members = (rawMembers ?? [])
    .map((m) => ({
      ...m,
      user_profiles: {
        display_name: displayNameByUserId.get(m.user_id as string) ?? null,
      },
    }))
    .sort((a, b) => {
      const rankDiff = (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return (a.joined_at ?? "").localeCompare(b.joined_at ?? "");
    });

  const { data: invites } = await supabase
    .from("team_invites")
    .select("id, email, role, created_at, expires_at")
    .eq("team_id", id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  // Org's customers
  const { data: customers } = await supabase
    .from("customers_v")
    .select("id, name, email, default_rate")
    .eq("team_id", id)
    .eq("archived", false)
    .order("name");

  // Org's projects
  const { data: projects } = await supabase
    .from("projects_v")
    .select("id, name, status, hourly_rate, customer_id, customers(name)")
    .eq("team_id", id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  // Org parent/child shares
  interface TeamShareRow {
    id: string;
    parent_team_id: string;
    child_team_id: string;
    sharing_level: string;
    accepted_at: string | null;
    teams: { name: string } | { name: string }[] | null;
  }
  const { data: parentSharesData } = await supabase
    .from("team_shares")
    .select(
      "id, parent_team_id, child_team_id, sharing_level, accepted_at, teams:parent_team_id(name)",
    )
    .eq("child_team_id", id);
  const { data: childSharesData } = await supabase
    .from("team_shares")
    .select(
      "id, parent_team_id, child_team_id, sharing_level, accepted_at, teams:child_team_id(name)",
    )
    .eq("parent_team_id", id);

  const parentShares = (parentSharesData ?? []) as unknown as TeamShareRow[];
  const childShares = (childSharesData ?? []) as unknown as TeamShareRow[];

  const userOrgs = await getUserTeams();
  const linkedTeamIds = new Set<string>([
    ...parentShares.map((s) => s.parent_team_id),
    ...childShares.map((s) => s.child_team_id),
  ]);
  const availableOrgsForRelationship = userOrgs
    .filter((o) => o.id !== id && !linkedTeamIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name }));

  const tc = await getTranslations("common");
  const tp = await getTranslations("projects");

  return (
    <div>
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{org.name}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-content-muted">
          {role}
        </span>
      </div>

      {/* Clients */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {tc("nav.customers")}
            </h2>
          </div>
          <Link
            href={`/customers?team=${id}`}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {customers && customers.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {customers.slice(0, 6).map((client) => (
              <Link
                key={client.id}
                href={`/customers/${client.id}`}
                className="rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm hover:bg-hover transition-colors"
              >
                <span className="font-medium text-content">{client.name}</span>
                {client.default_rate && (
                  <span className="ml-2 text-xs text-content-muted font-mono">
                    ${Number(client.default_rate).toFixed(0)}/hr
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-content-muted">No customers yet.</p>
        )}
      </div>

      {/* Projects */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {tc("nav.projects")}
            </h2>
          </div>
          <Link
            href={`/projects?team=${id}`}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {projects && projects.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((project) => {
              const customerName =
                project.customers &&
                typeof project.customers === "object" &&
                "name" in project.customers
                  ? (project.customers as { name: string }).name
                  : null;
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm hover:bg-hover transition-colors"
                >
                  <span className="font-medium text-content">
                    {project.name}
                  </span>
                  <span className="ml-2 text-xs text-content-muted">
                    {customerName ?? tp("internal")}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-content-muted">No projects yet.</p>
        )}
      </div>

      <TeamSettingsForm
        teamSettings={teamSettings}
        teamId={id}
        role={role}
      />

      <TeamSection
        teamName={org.name}
        teamId={id}
        isPersonalOrg={false}
        currentRole={role}
        currentUserId={userId}
        members={members}
        invites={invites ?? []}
      />

      <RelationshipsSection
        teamId={id}
        role={role}
        parentTeams={parentShares}
        childTeams={childShares}
        availableTeams={availableOrgsForRelationship}
      />
    </div>
  );
}
