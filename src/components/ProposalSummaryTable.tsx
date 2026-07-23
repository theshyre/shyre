"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/invoice-utils";
import { ItemPrice } from "@/components/ItemPrice";
import type { PricingType } from "@/lib/proposals/allow-lists";

interface SummaryItem {
  id?: string;
  title: string;
  summary: string | null;
  fixedPrice: number;
  pricingType?: PricingType;
  hourlyRate?: number | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
}

/**
 * The at-a-glance pricing table at the top of a proposal: # / Project / What it
 * does for you / Price, with a total row. Auto-generated from the line items so
 * it never drifts. Shown only for 2+ items (a single item is its own summary);
 * the "what it does" column appears only when at least one item has a summary.
 */
export function ProposalSummaryTable({
  items,
  total,
  currency,
  allFixedBid = true,
}: {
  items: SummaryItem[];
  total: number;
  currency: string;
  /** When false (a mixed proposal), the total carries a "billed by time" note —
   *  the sum is a conservative anchor, not one firm number. */
  allFixedBid?: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("proposals.summaryTable");
  const tp = useTranslations("proposals.pricing");
  if (items.length < 2) return null;
  const hasWhat = items.some((i) => i.summary && i.summary.trim() !== "");

  return (
    <section className="mt-[24px]">
      <h2 className="text-title font-semibold text-content">{t("heading")}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b border-edge">
              <th className="w-8 py-2 pr-2 text-left text-caption font-semibold text-content-muted">
                {t("colNum")}
              </th>
              <th className="py-2 pr-4 text-left text-caption font-semibold text-content-muted">
                {t("colProject")}
              </th>
              {hasWhat && (
                <th className="py-2 pr-4 text-left text-caption font-semibold text-content-muted">
                  {t("colWhat")}
                </th>
              )}
              <th className="py-2 pl-4 text-right text-caption font-semibold text-content-muted">
                {t("colPrice")}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id ?? i} className="border-b border-edge">
                <td className="py-2 pr-2 align-top text-content-secondary">
                  {i + 1}
                </td>
                <td className="py-2 pr-4 align-top font-medium text-content">
                  {item.title}
                </td>
                {hasWhat && (
                  <td className="py-2 pr-4 align-top text-content-secondary">
                    {item.summary ?? ""}
                  </td>
                )}
                <td className="py-2 pl-4 align-top text-right font-mono text-content">
                  <ItemPrice
                    pricingType={item.pricingType ?? "fixed_bid"}
                    fixedPrice={item.fixedPrice}
                    hourlyRate={item.hourlyRate}
                    estimateLow={item.estimateLow}
                    estimateHigh={item.estimateHigh}
                    currency={currency}
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td
                colSpan={hasWhat ? 3 : 2}
                className="py-2 pr-4 text-right font-semibold text-content"
              >
                {t("totalLabel")}
              </td>
              <td className="py-2 pl-4 text-right font-mono font-semibold text-content">
                {formatCurrency(total, currency)}
              </td>
            </tr>
            {!allFixedBid && (
              <tr>
                <td
                  colSpan={hasWhat ? 4 : 3}
                  className="pt-1 text-right text-caption text-content-muted"
                >
                  {tp("mixedTotalNote")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
