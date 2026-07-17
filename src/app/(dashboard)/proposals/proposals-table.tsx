import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileSignature } from "lucide-react";
import { CustomerChip } from "@/components/CustomerChip";
import { formatCurrency } from "@/lib/invoice-utils";
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
}

interface Props {
  proposals: ProposalRow[];
}

/** Proposal list table. Server-renderable — row navigation is plain links,
 *  no client state (bulk actions arrive with later phases). */
export function ProposalsTable({ proposals }: Props): React.JSX.Element {
  const t = useTranslations("proposals");

  if (proposals.length === 0) {
    return (
      <div className="mt-[48px] flex flex-col items-center gap-2 text-center">
        <FileSignature
          size={32}
          aria-hidden="true"
          className="text-content-muted"
        />
        <p className="text-body-lg font-medium text-content">
          {t("empty.heading")}
        </p>
        <p className="max-w-[480px] text-body text-content-secondary">
          {t("empty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-[16px] overflow-x-auto rounded-lg border border-edge">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-edge bg-surface-inset text-left text-caption text-content-secondary">
            <th className="px-3 py-2 font-medium">{t("table.number")}</th>
            <th className="px-3 py-2 font-medium">{t("table.title")}</th>
            <th className="px-3 py-2 font-medium">{t("table.customer")}</th>
            <th className="px-3 py-2 font-medium">{t("table.status")}</th>
            <th className="px-3 py-2 text-right font-medium">
              {t("table.total")}
            </th>
            <th className="px-3 py-2 font-medium">{t("table.issued")}</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => (
            <tr
              key={p.id}
              className="border-b border-edge last:border-b-0 hover:bg-hover"
            >
              <td className="px-3 py-2 font-mono text-caption">
                <Link
                  href={`/proposals/${p.id}`}
                  className="text-accent hover:underline"
                >
                  {p.proposal_number}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Link href={`/proposals/${p.id}`} className="hover:underline">
                  {p.title}
                </Link>
              </td>
              <td className="px-3 py-2">
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
              <td className="px-3 py-2">
                <ProposalStatusBadge status={p.status} />
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatCurrency(p.total, p.currency)}
              </td>
              <td className="px-3 py-2 text-content-secondary">
                {p.issued_date ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
