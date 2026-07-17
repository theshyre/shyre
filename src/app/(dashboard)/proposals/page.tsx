import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { TeamFilter } from "@/components/TeamFilter";
import { roundMoney } from "@/lib/proposals/line-items";
import { NewProposalLink } from "./new-proposal-link";
import { ProposalsTable, type ProposalRow } from "./proposals-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals");
  return { title: t("title") };
}

interface SearchParams {
  [key: string]: string | string[] | undefined;
  org?: string;
}

interface LineItemAgg {
  fixed_price: number | string;
  parent_line_item_id: string | null;
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const sp = await searchParams;
  const t = await getTranslations("proposals");

  const selectedTeamId = sp.org ?? null;

  // RLS scopes rows to teams where the viewer is owner/admin — members see an
  // empty list, which matches the invoices tier this module mirrors.
  let query = supabase
    .from("proposals")
    .select(
      "id, proposal_number, title, status, issued_date, valid_until, currency, customers(id, name), proposal_line_items(fixed_price, parent_line_item_id)",
    )
    .order("issued_date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  if (selectedTeamId) query = query.eq("team_id", selectedTeamId);
  const { data: rows } = await query;

  const proposals: ProposalRow[] = (rows ?? []).map((row) => {
    const customer = Array.isArray(row.customers)
      ? ((row.customers[0] ?? null) as { id: string; name: string } | null)
      : (row.customers as { id: string; name: string } | null);
    const items = (row.proposal_line_items ?? []) as LineItemAgg[];
    // Phases are a breakdown of their parent — only top-level rows count.
    const total = roundMoney(
      items
        .filter((li) => li.parent_line_item_id === null)
        .reduce((sum, li) => sum + Number(li.fixed_price), 0),
    );
    return {
      id: row.id as string,
      proposal_number: row.proposal_number as string,
      title: row.title as string,
      status: (row.status as string) ?? "draft",
      issued_date: (row.issued_date as string | null) ?? null,
      valid_until: (row.valid_until as string | null) ?? null,
      currency: (row.currency as string) ?? "USD",
      customer,
      total,
    };
  });

  const canCreate = teams.some((team) => isTeamAdmin(team.role));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-title font-semibold text-content">
            {t("title")}
          </h1>
          <TeamFilter teams={teams} selectedTeamId={selectedTeamId} />
        </div>
        {canCreate && <NewProposalLink label={t("new")} />}
      </div>
      <p className="mt-1 text-body text-content-secondary">{t("subtitle")}</p>
      <ProposalsTable proposals={proposals} />
    </div>
  );
}
