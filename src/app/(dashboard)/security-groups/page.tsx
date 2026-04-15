import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { SecurityGroupsSection } from "./security-groups-section";

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

  // Members of those groups (with profiles)
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: groupMembers } = groupIds.length
    ? await supabase
        .from("security_group_members")
        .select("group_id, user_id, user_profiles(display_name)")
        .in("group_id", groupIds)
    : { data: [] };

  // All members of user's teams (for the "add member" dropdown)
  const { data: teamMembers } = await supabase
    .from("team_members")
    .select("team_id, user_id, user_profiles(display_name)")
    .in("team_id", teamIds);

  return (
    <div>
      <div className="flex items-center gap-3">
        <ShieldCheck size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>
      <p className="mt-2 text-sm text-content-secondary">{t("description")}</p>

      <SecurityGroupsSection
        teams={teams}
        groups={groups ?? []}
        groupMembers={groupMembers ?? []}
        teamMembers={teamMembers ?? []}
      />
    </div>
  );
}
