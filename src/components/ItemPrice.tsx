"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/invoice-utils";
import { itemPriceDisplay } from "@/lib/proposals/line-items";
import type { PricingType } from "@/lib/proposals/allow-lists";

/**
 * The client-facing price string for a proposal line item, per pricing type:
 *   fixed_bid      → "$4,000.00"
 *   estimate_nte   → "Up to $10,000.00"
 *   estimate_range → "$3,000.00 – $5,000.00"
 *   estimate_tm    → "$200.00/hr"
 *
 * The pill (`<PricingTypeBadge>`) names the KIND; this names the NUMBER.
 */
export function ItemPrice({
  pricingType,
  fixedPrice,
  hourlyRate = null,
  estimateLow = null,
  estimateHigh = null,
  currency,
  className = "",
}: {
  pricingType: PricingType;
  fixedPrice: number;
  hourlyRate?: number | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  currency: string;
  className?: string;
}): React.JSX.Element {
  const t = useTranslations("proposals.pricing");
  const d = itemPriceDisplay({
    pricingType,
    fixedPrice,
    hourlyRate,
    estimateLow,
    estimateHigh,
  });

  let text: string;
  switch (d.kind) {
    case "nte":
      text = t("upTo", { amount: formatCurrency(d.cap, currency) });
      break;
    case "range":
      text = t("rangeValue", {
        low: formatCurrency(d.low, currency),
        high: formatCurrency(d.high, currency),
      });
      break;
    case "tm":
      text =
        d.rate != null
          ? t("perHourValue", { rate: formatCurrency(d.rate, currency) })
          : "—";
      break;
    case "fixed":
    default:
      text = formatCurrency(d.amount, currency);
      break;
  }

  return <span className={className}>{text}</span>;
}
