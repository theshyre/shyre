import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
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

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const sp = await searchParams;
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

  // ?customerId= preselects the customer (the "New proposal" button
  // on a customer detail page). Only honored when the id is in the
  // fetched list — which is already scoped to teams the viewer can
  // author for, so a pasted foreign id silently falls back to the
  // empty picker instead of leaking anything.
  const requestedCustomerId = sp.customerId?.trim() || null;
  const defaultCustomerId =
    requestedCustomerId &&
    customers.some((c) => c.id === requestedCustomerId)
      ? requestedCustomerId
      : null;

  return (
    <div>
      <div className="mb-[24px] flex items-center gap-3">
        <FileSignature size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">
          {t("newPageTitle")}
        </h1>
      </div>
      <ProposalForm
        teams={adminTeams.map((team) => ({ id: team.id, name: team.name }))}
        customers={customers}
        contacts={contacts}
        defaultCustomerId={defaultCustomerId}
      />
    </div>
  );
}
