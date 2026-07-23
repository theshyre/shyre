import type { Metadata } from "next";
import { FileCheck2 } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { SignoffForm, type CustomerOption } from "../signoff-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signoff");
  return { title: t("newPageTitle") };
}

export default async function NewSignoffPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("signoff");

  const adminTeams = teams.filter((team) => isTeamAdmin(team.role));
  if (adminTeams.length === 0) {
    // Members can't author sign-offs (invoice/proposal tier).
    redirect("/signoffs");
  }
  const adminTeamIds = adminTeams.map((team) => team.id);

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name, team_id")
    .eq("archived", false)
    .in("team_id", adminTeamIds)
    .order("name");

  const customers: CustomerOption[] = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    team_id: c.team_id as string,
  }));

  return (
    <div>
      <div className="mb-[24px] flex items-center gap-3">
        <FileCheck2 size={24} className="text-accent" aria-hidden="true" />
        <h1 className="text-page-title font-bold text-content">{t("newPageTitle")}</h1>
      </div>
      <p className="mb-6 max-w-[640px] text-body text-content-secondary">{t("newIntro")}</p>
      <SignoffForm
        teams={adminTeams.map((tm) => ({ id: tm.id, name: tm.name }))}
        customers={customers}
      />
    </div>
  );
}
