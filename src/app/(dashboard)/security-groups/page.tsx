import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { SecurityGroupsSection } from "./security-groups-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sharing.securityGroups");
  return { title: t("title") };
}

export default async function SecurityGroupsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const teamIds = teams.map((o) => o.id);
  const t = await getTranslations("sharing.securityGroups");

  // Groups across user's teams
  const { data: groups } = await supabase
    .from("security_groups")
    .select("*")
    .in("team_id", teamIds)
    .order("created_at", { ascending: false });

  // Members of those groups + all team members. Two-step fetch:
  // neither security_group_members nor team_members has an FK to
  // user_profiles (both go through auth.users separately), so
  // PostgREST embedding fails with PGRST200. Pull display names in
  // a single second query and stitch in JS.
  const groupIds = (groups ?? []).map((g) => g.id);
  const [groupMembersRes, teamMembersRes] = await Promise.all([
    groupIds.length
      ? supabase
          .from("security_group_members")
          .select("group_id, user_id")
          .in("group_id", groupIds)
      : Promise.resolve({
          data: [] as Array<{ group_id: string; user_id: string }>,
        }),
    supabase
      .from("team_members")
      .select("team_id, user_id")
      .in("team_id", teamIds),
  ]);
  const rawGroupMembers = groupMembersRes.data ?? [];
  const rawTeamMembers = teamMembersRes.data ?? [];

  const distinctUserIds = Array.from(
    new Set([
      ...rawGroupMembers.map((m) => m.user_id as string),
      ...rawTeamMembers.map((m) => m.user_id as string),
    ]),
  );
  const { data: profileRows } = distinctUserIds.length
    ? await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", distinctUserIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const profileByUserId = new Map<string, { display_name: string | null }>();
  for (const p of profileRows ?? []) {
    profileByUserId.set(p.user_id as string, {
      display_name: (p.display_name as string | null) ?? null,
    });
  }

  // Re-shape into the embedded form the client component already
  // accepts (`user_profiles` may be an object or an array). Object
  // form is the simpler shape; downstream `Array.isArray` checks
  // continue to work.
  const groupMembers = rawGroupMembers.map((m) => ({
    group_id: m.group_id,
    user_id: m.user_id,
    user_profiles: profileByUserId.get(m.user_id as string) ?? null,
  }));
  const teamMembers = rawTeamMembers.map((m) => ({
    team_id: m.team_id,
    user_id: m.user_id,
    user_profiles: profileByUserId.get(m.user_id as string) ?? null,
  }));

  return (
    <div>
      <div className="flex items-center gap-3">
        <ShieldCheck size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
      </div>
      <p className="mt-2 text-body-lg text-content-secondary">{t("description")}</p>

      <SecurityGroupsSection
        teams={teams}
        groups={groups ?? []}
        groupMembers={groupMembers}
        teamMembers={teamMembers}
      />
    </div>
  );
}
