import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess, getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Network } from "lucide-react";
import { RelationshipsSection } from "../relationships-section";

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
  const t = await getTranslations("common");
  return {
    title: `${t("teamHub.relationships.title")} — ${(team?.name as string) ?? ""}`,
  };
}

interface TeamShareRow {
  id: string;
  parent_team_id: string;
  child_team_id: string;
  sharing_level: string;
  accepted_at: string | null;
  teams: { name: string } | { name: string }[] | null;
}

/**
 * /teams/[id]/relationships — parent/child team shares.
 *
 * Same RelationshipsSection the legacy combined page rendered. Owner
 * / admin can propose + accept; member sees the roster.
 */
export default async function TeamRelationshipsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { role } = await validateTeamAccess(id);

  const { data: org } = await supabase
    .from("teams")
    .select("name")
    .eq("id", id)
    .single();
  if (!org) notFound();

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

  const t = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Network size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">
          {t("teamHub.relationships.title")}
        </h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        {t("teamHub.relationships.description")}
      </p>

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
