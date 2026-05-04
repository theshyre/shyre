import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { TeamSettingsForm } from "../team-settings-form";

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
    title: `${t("teamHub.general.title")} — ${(team?.name as string) ?? ""}`,
  };
}

/**
 * /teams/[id]/general — business identity (name, address, contact),
 * invoice defaults (rate, prefix, numbering, tax), branding, and the
 * team-level rate / time-entry visibility rules.
 *
 * Pulled out of /teams/[id] in the IA refactor so the team overview
 * isn't a wall of forms. Same form, same actions, just isolated to
 * its own URL.
 */
export default async function TeamGeneralPage({
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

  const { data: teamSettings } = await supabase
    .from("team_settings_v")
    .select("*")
    .eq("team_id", id)
    .single();

  const t = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">
          {t("teamHub.general.title")}
        </h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        {t("teamHub.general.description")}
      </p>

      <TeamSettingsForm
        teamSettings={teamSettings}
        teamId={id}
        role={role}
      />
    </div>
  );
}
