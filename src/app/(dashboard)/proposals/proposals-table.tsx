import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileSignature } from "lucide-react";
import { CustomerChip } from "@theshyre/ui";
import { PaginationFooter } from "@/components/PaginationFooter";
import {
  tableClass,
  tableWrapperClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
} from "@/lib/table-styles";
import { formatDisplayDate } from "@/lib/format-date";
import { formatCurrency } from "@/lib/invoice-utils";
import {
  daysSinceIsoDate,
  displayProposalTotal,
  isProposalExpired,
} from "@/lib/proposals/list-view";
import { ProposalStatusBadge } from "./proposal-status-badge";

export interface ProposalRow {
  id: string;
  proposal_number: string;
  title: string;
  status: string;
  issued_date: string | null;
  valid_until: string | null;
  currency: string;
  customer: { id: string; name: string; logo_url: string | null } | null;
  /** Sum of top-level line-item fixed prices (computed by the page). */
  total: number;
  /** The client-authorized subset total, once accepted. Null until then. */
  accepted_total: number | null;
}

interface Props {
  proposals: ProposalRow[];
  /** Rows matching the current filter (server-side count) — drives
   *  the load-more footer. */
  totalCount: number;
  /** Local YYYY-MM-DD — passed in so read-time expiry + aging agree
   *  with the page's outstanding rollup. */
  today: string;
}

/** Proposal list table. Server-renderable — row navigation is plain links,
 *  no client state (bulk actions arrive with later phases). */
export function ProposalsTable({
  proposals,
  totalCount,
  today,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals");

  if (proposals.length === 0) {
    // Bordered-card + icon-circle empty state — the one list-page
    // treatment (docs/reference/list-pages.md rule 6; reference:
    // invoices-table.tsx).
    return (
      <div className="mt-[16px] rounded-lg border border-edge bg-surface-raised p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <FileSignature size={20} className="text-accent" aria-hidden="true" />
        </div>
        <h3 className="text-body-lg font-medium text-content">
          {t("empty.heading")}
        </h3>
        <p className="mt-1 text-caption text-content-muted max-w-md mx-auto">
          {t("empty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className={`mt-[16px] overflow-x-auto ${tableWrapperClass}`}>
      <table className={tableClass}>
        <thead>
          <tr className={`${tableHeaderRowClass} text-left`}>
            <th className={tableHeaderCellClass}>{t("table.number")}</th>
            <th className={tableHeaderCellClass}>{t("table.title")}</th>
            <th className={tableHeaderCellClass}>{t("table.customer")}</th>
            <th className={tableHeaderCellClass}>{t("table.status")}</th>
            <th className={`${tableHeaderCellClass} text-right`}>
              {t("table.total")}
            </th>
            <th className={tableHeaderCellClass}>{t("table.issued")}</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => {
            const expired = isProposalExpired(p.status, p.valid_until, today);
            const inFlight = p.status === "sent" || p.status === "viewed";
            const sentDays = inFlight
              ? daysSinceIsoDate(p.issued_date, today)
              : null;
            return (
              <tr key={p.id} className={tableBodyRowClass}>
                <td className={`${tableBodyCellClass} font-mono text-caption`}>
                  <Link
                    href={`/proposals/${p.id}`}
                    className="text-accent hover:underline"
                  >
                    {p.proposal_number}
                  </Link>
                </td>
                <td className={`${tableBodyCellClass} text-content`}>
                  <Link href={`/proposals/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                </td>
                <td className={tableBodyCellClass}>
                  <span className="inline-flex items-center gap-2">
                    <CustomerChip
                      customerId={p.customer?.id}
                      customerName={p.customer?.name}
                      logoUrl={p.customer?.logo_url ?? null}
                      size={24}
                    />
                    <span>{p.customer?.name ?? "—"}</span>
                  </span>
                </td>
                <td className={tableBodyCellClass}>
                  <ProposalStatusBadge status={p.status} expired={expired} />
                </td>
                <td className={`${tableBodyCellClass} text-right font-mono`}>
                  {formatCurrency(
                    displayProposalTotal(p.status, p.total, p.accepted_total),
                    p.currency,
                  )}
                </td>
                <td className={tableBodyCellClass}>
                  {formatDisplayDate(p.issued_date)}
                  {/* Aging caption on in-flight rows — how long the
                      offer has been sitting unanswered. Skipped for
                      same-day sends (0d reads as noise). */}
                  {sentDays !== null && sentDays >= 1 && (
                    <span className="mt-0.5 block text-caption text-content-muted">
                      {t("list.sentDaysAgo", { days: sentDays })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PaginationFooter loaded={proposals.length} total={totalCount} />
    </div>
  );
}
