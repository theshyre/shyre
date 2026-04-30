import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FileText, Download } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("title") };
}
import { formatDate } from "@theshyre/ui";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { effectiveInvoiceStatus } from "@/lib/invoice-status";
import { TeamFilter } from "@/components/TeamFilter";
import { Tooltip } from "@/components/Tooltip";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { NewInvoiceLink } from "./new-invoice-link";
import { InvoiceFilters } from "./invoice-filters";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { PaginationFooter } from "@/components/PaginationFooter";

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

  const teamName = (teamId: string) =>
    teams.find((o) => o.id === teamId)?.name ?? "—";

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

      {invoices && invoices.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.invoiceNumber")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.team")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.customer")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.issuedDate")}
                </th>
                <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.total")}
                </th>
                <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const customerName =
                  inv.customers &&
                  typeof inv.customers === "object" &&
                  "name" in inv.customers
                    ? (inv.customers as { name: string }).name
                    : "—";
                const isImported =
                  (inv.imported_from as string | null) === "harvest";
                const displayStatus = effectiveInvoiceStatus(
                  (inv.status as string | null) ?? "draft",
                  (inv.due_date as string | null) ?? null,
                  today,
                );
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="text-accent hover:underline font-medium font-mono"
                        >
                          {inv.invoice_number}
                        </Link>
                        {isImported && (
                          <Tooltip label={t("table.importedFromHarvest")}>
                            <span
                              aria-label={t("table.importedFromHarvest")}
                              className="inline-flex items-center text-content-muted"
                            >
                              <Download size={12} aria-hidden="true" />
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-caption">
                      {teamName(inv.team_id)}
                    </td>
                    <td className="px-4 py-3 text-content-secondary">
                      {customerName}
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-caption">
                      {inv.issued_date ? formatDate(inv.issued_date) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-content">
                      {inv.total
                        ? formatCurrency(
                            Number(inv.total),
                            (inv.currency as string | null) ?? undefined,
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={displayStatus} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationFooter
            loaded={invoices.length}
            total={matchingCount ?? invoices.length}
          />
        </div>
      ) : (
        <p className="mt-4 text-body text-content-muted">{t("noInvoices")}</p>
      )}
    </div>
  );
}
