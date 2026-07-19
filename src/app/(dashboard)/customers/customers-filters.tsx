"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { FilterChip } from "@/components/FilterChip";

export const CUSTOMER_STATUS_KEYS = [
  "all",
  "active",
  "inactive",
  "archived",
] as const;
export type CustomerStatusKey = (typeof CUSTOMER_STATUS_KEYS)[number];

/**
 * URL-driven lifecycle status chip for /customers — replaces the four
 * pill Links (list-pages.md rule 1: one Status chip, instant-apply).
 * Default = "all" (active + inactive, badged): the page deliberately
 * shows dormant customers by default, so "all" is stripped from the
 * URL and everything else writes `?status=`. `?status=archived` keeps
 * driving the archived/restore surface exactly as the old pill did.
 */
export function CustomerStatusFilter({
  selected,
}: {
  selected: CustomerStatusKey;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("customers");

  function pick(next: CustomerStatusKey): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    // Changing a filter resets the load-more window (list-pages.md
    // rule 1) — a deep ?limit= from the previous filter would force a
    // giant first page of the new result set.
    params.delete("limit");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <FilterChip<CustomerStatusKey>
      icon={<CheckCircle size={12} aria-hidden="true" />}
      dimensionLabel={t("statusFilter.dimension")}
      valueLabel={t(`filter.${selected}`)}
      listboxLabel={t("statusFilter.listboxLabel")}
      customized={selected !== "all"}
      panelClassName="w-[180px]"
      options={CUSTOMER_STATUS_KEYS.map((s) => ({
        key: s,
        label: t(`filter.${s}`),
        selected: selected === s,
      }))}
      onPick={pick}
    />
  );
}
