"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";
import { FilterChip } from "@/components/FilterChip";
import {
  PROPOSAL_STATUS_FILTERS,
  type ProposalStatusFilter,
} from "@/lib/proposals/list-view";

/**
 * URL-driven status filter chip for the proposals list, on the shared
 * <FilterChip> scaffold — proposal-shaped buckets: Sent folds in
 * `viewed` ("in flight"), History folds superseded + converted.
 * Default = "all" (a proposal list is short enough that the unfiltered
 * view is the home view), so `all` stays out of the URL.
 */
export function ProposalStatusFilterChip({
  selected,
}: {
  selected: ProposalStatusFilter;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("proposals.filters.status");

  function pick(next: ProposalStatusFilter): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    // Reset pagination — a narrower filter with an inherited big
    // `limit` would silently over-fetch.
    params.delete("limit");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <FilterChip<ProposalStatusFilter>
      icon={<Filter size={12} aria-hidden="true" />}
      dimensionLabel={t("dimension")}
      valueLabel={t(`label.${selected}`)}
      listboxLabel={t("listboxLabel")}
      customized={selected !== "all"}
      panelClassName="w-[200px]"
      options={PROPOSAL_STATUS_FILTERS.map((s) => ({
        key: s,
        label: t(`label.${s}`),
        selected: selected === s,
      }))}
      onPick={pick}
    />
  );
}
