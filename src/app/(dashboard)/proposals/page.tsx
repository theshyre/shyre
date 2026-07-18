import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { TeamFilter } from "@/components/TeamFilter";
import { roundMoney } from "@/lib/proposals/line-items";
import {
  parseProposalStatusFilter,
  proposalFilterStatuses,
  summarizeOutstandingProposals,
} from "@/lib/proposals/list-view";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { unwrapEmbed } from "@/lib/supabase/embed";
import { formatCurrency } from "@/lib/invoice-utils";
import { NewProposalLink } from "./new-proposal-link";
import { ProposalStatusFilterChip } from "./proposals-filters";
import { ProposalsTable, type ProposalRow } from "./proposals-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals");
  return { title: t("title") };
}

interface SearchParams {
  [key: string]: string | string[] | undefined;
  org?: string;
  status?: string;
  limit?: string;
}

interface LineItemAgg {
  fixed_price: number | string;
  parent_line_item_id: string | null;
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const statusFilter = parseProposalStatusFilter(sp.status);
  const filterStatuses = proposalFilterStatuses(statusFilter);
  const { limit } = parseListPagination(sp);

  // RLS scopes rows to teams where the viewer is owner/admin — members see an
  // empty list, which matches the invoices tier this module mirrors.
  //
  // count: "exact" returns rows + the full match count in one RLS pass;
  // .range() clips to the load-more window (same shape as /invoices).
  let query = supabase
    .from("proposals")
    .select(
      "id, proposal_number, title, status, issued_date, valid_until, currency, accepted_total, customers(id, name, logo_url), proposal_line_items(fixed_price, parent_line_item_id)",
      { count: "exact" },
    )
    .order("issued_date", { ascending: false, nullsFirst: false })
    // Tiebreak on creation time, not the random UUID `id` — several proposals
    // issued the same day were sorting in a meaningless order. (Index:
    // idx_proposals_team on (team_id, created_at DESC).)
    .order("created_at", { ascending: false });
  if (selectedTeamId) query = query.eq("team_id", selectedTeamId);
  if (filterStatuses) query = query.in("status", filterStatuses);
  const { data: rows, count: matchingCount } = await query.range(0, limit - 1);

  interface CustomerCell {
    id: string;
    name: string;
    logo_url: string | null;
  }
  const proposals: ProposalRow[] = (rows ?? []).map((row) => {
    const customer = unwrapEmbed(
      row.customers as CustomerCell | CustomerCell[] | null,
    );
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
      accepted_total:
        row.accepted_total != null ? Number(row.accepted_total) : null,
    };
  });

  const canCreate = teams.some((team) => isTeamAdmin(team.role));

  // Read-time expiry + aging both key off the local calendar day —
  // same derivation as the invoices list's overdue check.
  const today = todayLocalDate();

  // "$X awaiting signature" — count + summed total of the loaded
  // in-flight (sent/viewed) rows. Computed from the fetched window so
  // it always agrees with the rows on screen. Proposals are USD-only
  // in v1 (DB default, no picker), so one summed figure is honest.
  const outstanding = summarizeOutstandingProposals(proposals);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <FileSignature size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content">
            {t("title")}
          </h1>
          <TeamFilter teams={teams} selectedTeamId={selectedTeamId} />
          <ProposalStatusFilterChip selected={statusFilter} />
        </div>
        {canCreate && <NewProposalLink label={t("new")} />}
      </div>
      <p className="mt-1 text-body text-content-secondary">{t("subtitle")}</p>
      {outstanding.count > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-body text-content-secondary">
          <Send size={14} aria-hidden="true" className="text-info" />
          <span>
            {t("list.outstanding", {
              count: outstanding.count,
              total: formatCurrency(outstanding.total, "USD"),
            })}
          </span>
        </p>
      )}
      <ProposalsTable
        proposals={proposals}
        totalCount={matchingCount ?? proposals.length}
        today={today}
      />
    </div>
  );
}
