import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { isProposalEditable, type DepositType } from "../../allow-lists";
import {
  ProposalForm,
  type ProposalFormInitial,
  type CustomerOption,
  type ContactOption,
} from "../../proposal-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals");
  return { title: t("editPageTitle") };
}

interface LineItemRow {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  body_markdown: string | null;
  description: string | null;
  why_it_matters: string | null;
  out_of_scope: string | null;
  definition_of_done: string | null;
  fixed_price: number | string;
  is_capped: boolean;
}

export default async function EditProposalPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}): Promise<React.JSX.Element> {
  const { proposalId } = await params;
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("proposals");

  const { data: proposal } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();
  if (!proposal) notFound();

  // Sent proposals are frozen — bounce to the read-only detail view rather
  // than presenting an editor whose save is guaranteed to be refused.
  if (!isProposalEditable(proposal.status as string)) {
    redirect(`/proposals/${proposalId}`);
  }

  const team = teams.find((candidate) => candidate.id === proposal.team_id);
  if (!team || !isTeamAdmin(team.role)) {
    redirect(`/proposals/${proposalId}`);
  }

  const { data: itemRows } = await supabase
    .from("proposal_line_items")
    .select(
      "id, parent_line_item_id, sort_order, title, body_markdown, description, why_it_matters, out_of_scope, definition_of_done, fixed_price, is_capped",
    )
    .eq("proposal_id", proposalId)
    .order("sort_order");

  const { data: signerRows } = await supabase
    .from("proposal_signers")
    .select("contact_id, sort_order")
    .eq("proposal_id", proposalId)
    .order("sort_order");
  const rosterIds = (signerRows ?? []).map((r) => r.contact_id as string);

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name, team_id")
    .eq("archived", false)
    .eq("team_id", proposal.team_id as string)
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

  const rows = (itemRows ?? []) as LineItemRow[];
  const parents = rows.filter((r) => r.parent_line_item_id === null);

  const initial: ProposalFormInitial = {
    proposalId,
    team_id: proposal.team_id as string,
    customer_id: proposal.customer_id as string,
    signer_contact_id: (proposal.signer_contact_id as string | null) ?? null,
    signers:
      rosterIds.length > 0
        ? rosterIds
        : proposal.signer_contact_id
          ? [proposal.signer_contact_id as string]
          : [],
    signing_mode: (proposal.signing_mode as "first" | "all") ?? "first",
    title: proposal.title as string,
    issued_date: (proposal.issued_date as string | null) ?? null,
    valid_until: (proposal.valid_until as string | null) ?? null,
    payment_terms_days: (proposal.payment_terms_days as number | null) ?? null,
    deposit_type: (proposal.deposit_type as DepositType) ?? "none",
    deposit_value:
      proposal.deposit_value != null ? Number(proposal.deposit_value) : null,
    warranty_days: (proposal.warranty_days as number | null) ?? null,
    terms_notes: (proposal.terms_notes as string | null) ?? null,
    overview_markdown: (proposal.overview_markdown as string | null) ?? null,
    items: parents.map((parent) => ({
      title: parent.title,
      bodyMarkdown: parent.body_markdown ?? null,
      description: parent.description,
      whyItMatters: parent.why_it_matters,
      outOfScope: parent.out_of_scope,
      definitionOfDone: parent.definition_of_done,
      fixedPrice: Number(parent.fixed_price),
      isCapped: parent.is_capped,
      phases: rows
        .filter((r) => r.parent_line_item_id === parent.id)
        .map((phase) => ({
          title: phase.title,
          description: phase.description,
          fixedPrice: Number(phase.fixed_price),
        })),
    })),
  };

  return (
    <div>
      <h1 className="mb-[24px] text-page-title font-semibold text-content">
        {t("editPageTitle")}
      </h1>
      <ProposalForm
        teams={[{ id: team.id, name: team.name }]}
        customers={customers}
        contacts={contacts}
        initial={initial}
      />
    </div>
  );
}
