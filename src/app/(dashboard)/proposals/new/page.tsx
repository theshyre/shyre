import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import {
  ProposalForm,
  type CustomerOption,
  type ContactOption,
} from "../proposal-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals");
  return { title: t("newPageTitle") };
}

export default async function NewProposalPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("proposals");

  const adminTeams = teams.filter((team) => isTeamAdmin(team.role));
  if (adminTeams.length === 0) {
    // Members can't author proposals (same tier as invoicing).
    redirect("/proposals");
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

  const { data: contactRows } = await supabase
    .from("customer_contacts")
    .select("id, name, email, customer_id, role_label")
    .in(
      "customer_id",
      customers.map((c) => c.id),
    )
    .order("name");
  const contacts: ContactOption[] = (contactRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    email: c.email as string,
    customer_id: c.customer_id as string,
    role_label: (c.role_label as string | null) ?? null,
  }));

  return (
    <div>
      <h1 className="mb-[24px] text-page-title font-semibold text-content">
        {t("newPageTitle")}
      </h1>
      <ProposalForm
        teams={adminTeams.map((team) => ({ id: team.id, name: team.name }))}
        customers={customers}
        contacts={contacts}
      />
    </div>
  );
}
