"use client";

import { useTranslations } from "next-intl";
import { Coins, Gauge, ArrowLeftRight, Clock } from "lucide-react";
import type { PricingType } from "@/lib/proposals/allow-lists";

/**
 * The per-line pricing-type identifier on a proposal — icon + word + color
 * (redundant encoding; never color alone), reusing the rounded-full pill idiom
 * of the "Authorized" chip. Shown per line item ONLY on a MIXED proposal; a
 * homogeneous fixed-bid deal shows a single document-level assurance instead
 * (see `isHomogeneousFixedBid`), so this stays out of the all-fixed-bid case.
 */
const META: Record<
  PricingType,
  { icon: typeof Coins; key: string; className: string }
> = {
  fixed_bid: {
    icon: Coins,
    key: "fixedBid",
    className: "border-accent/30 bg-accent-soft text-accent",
  },
  estimate_nte: {
    icon: Gauge,
    key: "nte",
    className: "border-warning/30 bg-warning-soft text-warning-text",
  },
  estimate_range: {
    icon: ArrowLeftRight,
    key: "range",
    className: "border-info/30 bg-info-soft text-info-text",
  },
  estimate_tm: {
    icon: Clock,
    key: "tm",
    className: "border-edge bg-surface-sunken text-content-secondary",
  },
};

export function PricingTypeBadge({
  type,
  className = "",
}: {
  type: PricingType;
  className?: string;
}): React.JSX.Element {
  const t = useTranslations("proposals.pricing");
  const meta = META[type];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium ${meta.className} ${className}`}
    >
      <Icon size={12} aria-hidden="true" />
      {t(meta.key)}
    </span>
  );
}
