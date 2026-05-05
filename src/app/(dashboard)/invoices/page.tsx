import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { FileText, Download } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("title") };
}
import { buttonSecondaryClass } from "@/lib/form-styles";
import { TeamFilter } from "@/components/TeamFilter";
import { NewInvoiceLink } from "./new-invoice-link";
import { InvoiceFilters } from "./invoice-filters";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";

interface SearchParams {
  [key: string]: string | string[] | undefined;
  org?: string;
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
  limit?: string;
}

function pickString(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v ? v : null;
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const sp = await searchParams;
  const t = await getTranslations("invoices");

  const selectedTeamId = sp.org ?? null;
  const filters = {
    status: pickString(sp.status),
    customerId: pickString(sp.customerId),
    from: pickString(sp.from),
    to: pickString(sp.to),
  };
  const { limit } = parseListPagination(sp);

  // count: "exact" returns rows + full match count in one RLS
  // pass; .range() clips to the load-more window.
  //
  // Ordering: latest invoice first, by the issue date the user
  // sees in the Issued column — not internal created_at, which on
  // bulk imports can clump or even invert relative to issued_date
  // and produces a list ordered by import time instead of business
  // time. id DESC is the tiebreaker for same-day invoices and
  // keeps .range() stable across "Load more" under concurrent
  // writes.
  let query = supabase
    .from("invoices")
    .select("*, customers(name)", { count: "exact" })
    .order("issued_date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  if (selectedTeamId) query = query.eq("team_id", selectedTeamId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.from) query = query.gte("issued_date", filters.from);
  if (filters.to) query = query.lte("issued_date", filters.to);
  const { data: invoices, count: matchingCount } = await query.range(
    0,
    limit - 1,
  );

  // Customer list for the filter dropdown — scoped to the active team
  // when one is selected, otherwise all customers the viewer can see.
  let customerQuery = supabase
    .from("customers")
    .select("id, name")
    .eq("archived", false)
    .order("name");
  if (selectedTeamId) customerQuery = customerQuery.eq("team_id", selectedTeamId);
  const { data: customerRows } = await customerQuery;
  const customers = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  const teamNameById = new Map(
    teams.map((o) => [o.id as string, (o.name as string) ?? "—"]),
  );

  // Read-time auto-overdue. We don't mutate the DB here — bookkeepers
  // expect the AR aging report to reflect today's reality without us
  // silently flipping the stored status.
  const today = todayLocalDate();

  // Build CSV link with the same filters (so the export reflects the
  // current view, not the unfiltered firehose).
  const csvParams = new URLSearchParams();
  if (selectedTeamId) csvParams.set("org", selectedTeamId);
  for (const [k, v] of Object.entries(filters)) {
    if (v) csvParams.set(k, v);
  }
  const csvHref =
    `/api/invoices/csv` +
    (csvParams.toString() ? `?${csvParams.toString()}` : "");

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <FileText size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content">
            {t("title")}
          </h1>
          <TeamFilter teams={teams} selectedTeamId={selectedTeamId} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {invoices && invoices.length > 0 && (
            <a
              href={csvHref}
              download
              className={`${buttonSecondaryClass} inline-flex items-center gap-1.5`}
            >
              <Download size={14} />
              {t("exportCsv")}
            </a>
          )}
          <NewInvoiceLink label={t("newInvoice")} />
        </div>
      </div>

      <div className="mt-4">
        <InvoiceFilters
          selectedTeamId={selectedTeamId}
          customers={customers}
          currentFilters={filters}
        />
      </div>

      <InvoicesTable
        invoices={(invoices ?? []) as unknown as InvoiceRow[]}
        totalCount={matchingCount ?? invoices?.length ?? 0}
        teamNameById={teamNameById}
        today={today}
        importedTooltip={t("table.importedFromHarvest")}
      />
    </div>
  );
}
