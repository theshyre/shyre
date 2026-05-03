import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FolderKanban, Users } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!customer) {
    const t = await getTranslations("customers");
    return { title: t("title") };
  }
  return { title: customer.name as string };
}
import { CustomerEditForm } from "./customer-edit-form";
import { SharingSection } from "./sharing-section";
import { PermissionsSection } from "./permissions-section";

interface ShareRow {
  id: string;
  team_id: string;
  can_see_others_entries: boolean;
  teams: { name: string } | { name: string }[] | null;
}

interface PermRow {
  id: string;
  principal_type: "user" | "group";
  principal_id: string;
  permission_level: "viewer" | "contributor" | "admin";
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  user_profiles:
    | { display_name: string | null; is_shell: boolean | null }[]
    | { display_name: string | null; is_shell: boolean | null }
    | null;
}

interface SecurityGroupRow {
  id: string;
  team_id: string;
  name: string;
}

function displayName(
  profile:
    | { display_name: string | null }[]
    | { display_name: string | null }
    | null,
  fallback: string,
): string {
  const p = Array.isArray(profile) ? profile[0] : profile;
  return p?.display_name ?? fallback;
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("customers");

  const { data: client } = await supabase
    .from("customers_v")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { data: projects } = await supabase
    .from("projects_v")
    .select("*")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });

  // Sharing data
  const { data: sharesData } = await supabase
    .from("customer_shares")
    .select("id, team_id, can_see_others_entries, teams(name)")
    .eq("customer_id", id);
  const shares = (sharesData ?? []) as unknown as ShareRow[];

  // Permission level for current user
  const { data: permLevel } = await supabase.rpc("user_customer_permission", {
    p_customer_id: id,
  });
  const userCanAdmin = permLevel === "admin";

  // User's teams (for available teams & primary change)
  const userOrgs = await getUserTeams();
  const sharedTeamIds = new Set(shares.map((s) => s.team_id));
  const availableTeams = userOrgs
    .filter((o) => o.id !== client.team_id && !sharedTeamIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name }));

  // Primary org name
  const { data: primaryTeam } = await supabase
    .from("teams")
    .select("id, name")
    .eq("id", client.team_id)
    .single();
  const primaryTeamName = primaryTeam?.name ?? "—";

  // Can change primary: user is owner of current primary
  const currentPrimaryMembership = userOrgs.find(
    (o) => o.id === client.team_id,
  );
  const canChangePrimary = currentPrimaryMembership?.role === "owner";
  const changePrimaryTeams = userOrgs
    .filter((o) => o.id !== client.team_id)
    .map((o) => ({ id: o.id, name: o.name }));

  // Permissions data
  const { data: permsData } = await supabase
    .from("customer_permissions")
    .select("id, principal_type, principal_id, permission_level")
    .eq("customer_id", id);
  const perms = (permsData ?? []) as unknown as PermRow[];

  // Participating org ids (primary + shared) for member/group lookup
  const allTeamIds = [
    client.team_id,
    ...shares.map((s) => s.team_id),
  ];

  // Members of all those teams. Two-step fetch: team_members has no
  // FK to user_profiles (both reference auth.users separately), so
  // PostgREST embedding fails with PGRST200. Pull profiles in a
  // second query and stitch on the embedded shape the principal
  // picker / display-name resolver already expects.
  const { data: rawTeamMembers } = allTeamIds.length
    ? await supabase
        .from("team_members")
        .select("team_id, user_id")
        .in("team_id", allTeamIds)
    : { data: [] as Array<{ team_id: string; user_id: string }> };
  const distinctMemberUserIds = Array.from(
    new Set((rawTeamMembers ?? []).map((m) => m.user_id as string)),
  );
  const { data: memberProfileRows } = distinctMemberUserIds.length
    ? await supabase
        .from("user_profiles")
        .select("user_id, display_name, is_shell")
        .in("user_id", distinctMemberUserIds)
    : {
        data: [] as Array<{
          user_id: string;
          display_name: string | null;
          is_shell: boolean | null;
        }>,
      };
  const profileByMemberUserId = new Map<
    string,
    { display_name: string | null; is_shell: boolean | null }
  >();
  for (const p of memberProfileRows ?? []) {
    profileByMemberUserId.set(p.user_id as string, {
      display_name: (p.display_name as string | null) ?? null,
      is_shell: (p.is_shell as boolean | null) ?? null,
    });
  }
  const teamMembers: TeamMemberRow[] = (rawTeamMembers ?? []).map((m) => ({
    team_id: m.team_id as string,
    user_id: m.user_id as string,
    user_profiles: profileByMemberUserId.get(m.user_id as string) ?? null,
  }));

  // Security groups of all those teams
  const { data: groupsData } = allTeamIds.length
    ? await supabase
        .from("security_groups")
        .select("id, team_id, name")
        .in("team_id", allTeamIds)
    : { data: [] };
  const groups = (groupsData ?? []) as unknown as SecurityGroupRow[];

  // Org name lookup for display
  const teamNameById = new Map<string, string>();
  teamNameById.set(client.team_id, primaryTeamName);
  for (const s of shares) {
    const name = Array.isArray(s.teams)
      ? s.teams[0]?.name
      : s.teams?.name;
    if (name) teamNameById.set(s.team_id, name);
  }

  // Build available principals list (dedupe users by id)
  const seenUserIds = new Set<string>();
  const availablePrincipals: Array<{
    type: "user" | "group";
    id: string;
    name: string;
    teamName: string;
  }> = [];
  for (const m of teamMembers) {
    if (seenUserIds.has(m.user_id)) continue;
    // Shell accounts can't sign in, so granting them customer
    // permissions is meaningless clutter. Skip them entirely from
    // the principal picker. They still appear in the team member
    // list (with the "Imported · no login" badge) for audit /
    // authorship visibility.
    const profileRaw = m.user_profiles;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    if (profile && (profile as { is_shell?: boolean | null }).is_shell) {
      continue;
    }
    seenUserIds.add(m.user_id);
    availablePrincipals.push({
      type: "user",
      id: m.user_id,
      name: displayName(m.user_profiles, m.user_id.slice(0, 8) + "…"),
      teamName: teamNameById.get(m.team_id) ?? "—",
    });
  }
  for (const g of groups) {
    availablePrincipals.push({
      type: "group",
      id: g.id,
      name: g.name,
      teamName: teamNameById.get(g.team_id) ?? "—",
    });
  }

  // Resolve principal_name for existing permissions
  const userNameById = new Map<string, string>();
  for (const m of teamMembers) {
    if (!userNameById.has(m.user_id)) {
      userNameById.set(
        m.user_id,
        displayName(m.user_profiles, m.user_id.slice(0, 8) + "…"),
      );
    }
  }
  const groupNameById = new Map<string, string>();
  for (const g of groups) groupNameById.set(g.id, g.name);

  const permissions = perms.map((p) => ({
    id: p.id,
    principal_type: p.principal_type,
    principal_id: p.principal_id,
    permission_level: p.permission_level,
    principal_name:
      p.principal_type === "user"
        ? userNameById.get(p.principal_id) ??
          p.principal_id.slice(0, 8) + "…"
        : groupNameById.get(p.principal_id) ?? "Group",
  }));

  // Defensive fallback: customers.name is NOT NULL in schema, so
  // this only fires if the column constraint changes or a future
  // migration adds nullable rows. Mirrors the business/team
  // headers — every detail page is required to render
  // identifying text in the h1, never a generic noun.
  const customerName = (client.name as string | null) ?? t("untitled");

  return (
    <div>
      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content break-words">
          {customerName}
        </h1>
      </div>
      <p className="mt-1 text-caption text-content-muted">
        {t("editSubtitle")}
      </p>

      <div className="mt-6">
        <CustomerEditForm client={client} />
      </div>

      <div className="mt-8">
        <div className="flex items-center gap-3">
          <FolderKanban size={20} className="text-accent" />
          <h2 className="text-lg font-semibold text-content">
            {t("projects.title")}
          </h2>
        </div>
        {projects && projects.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3 hover:bg-hover transition-colors"
              >
                <div>
                  <span className="font-medium text-content">{p.name}</span>
                  {p.status !== "active" && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-xs text-content-muted">
                      {p.status}
                    </span>
                  )}
                </div>
                <span className="text-sm text-content-secondary font-mono">
                  {p.hourly_rate
                    ? `$${Number(p.hourly_rate).toFixed(2)}/hr`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-content-muted">
            {t("projects.noProjects")}
          </p>
        )}
      </div>

      <SharingSection
        customerId={id}
        primaryTeamId={client.team_id}
        primaryTeamName={primaryTeamName}
        shares={shares}
        availableTeams={availableTeams}
        userCanAdmin={userCanAdmin}
        changePrimaryTeams={changePrimaryTeams}
        canChangePrimary={canChangePrimary}
      />

      <PermissionsSection
        customerId={id}
        permissions={permissions}
        availablePrincipals={availablePrincipals}
        userCanAdmin={userCanAdmin}
      />
    </div>
  );
}
