"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { CustomerChip } from "@theshyre/ui";
import { FilterChip, type FilterChipOption } from "@/components/FilterChip";

export interface CustomerFilterOption {
  id: string;
  name: string;
  /** Uploaded logo — the stronger identity-mark when present. */
  logo_url?: string | null;
}

interface Props {
  /** Customer list to pick from. Typically derived server-side from
   *  the active team's projects (each project carries its
   *  `customers(id, name)` row), de-duped, sorted by name. */
  customers: CustomerFilterOption[];
  /** Currently-selected customer id, or null when the filter is off
   *  ("All customers"). */
  selectedId: string | null;
}

/** Sentinel key for the "All customers" option — customer ids are
 *  UUIDs so this can't collide with a real row. */
const ALL_KEY = "__all__";

/**
 * URL-driven customer picker for `/time-entries`. Composes with the
 * existing project filter — if both are set, the server intersects
 * (entries must be on a project whose customer matches AND whose id
 * is in the project rollup). Picking a customer doesn't auto-clear
 * the project filter on purpose: a user can scope to "EyeReg → Phase
 * 1" by clicking both filters in sequence. If the project filter
 * resolves to a project outside the selected customer, the result
 * is an empty set — surfaced as the standard "no entries match"
 * empty state, not as an error.
 *
 * Internal projects (no `customers` FK) sit under their own implicit
 * "Internal" bucket which is NOT in this picker — the only way to
 * filter to Internal-only is via the project filter today. Adding a
 * synthetic "Internal" customer here is on the Phase 2 list.
 *
 * Built on the shared `<FilterChip>` scaffold (list-pages.md rule 1 +
 * a11y invariants) instead of a hand-rolled dropdown — the previous
 * implementation only closed on outside click, so Escape did nothing
 * and focus never returned to the trigger.
 */
export function CustomerFilter({
  customers,
  selectedId,
}: Props): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("common.customerFilter");

  if (customers.length === 0) return null;

  const selected =
    selectedId !== null
      ? customers.find((c) => c.id === selectedId) ?? null
      : null;

  function pick(key: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (key === ALL_KEY) {
      params.delete("customer");
    } else {
      params.set("customer", key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const options: FilterChipOption[] = [
    {
      key: ALL_KEY,
      label: t("all"),
      icon: (
        <Building2 size={12} className="text-content-muted" aria-hidden="true" />
      ),
      selected: selected === null,
      labelClassName: "font-medium text-content",
      separatorAfter: true,
    },
    ...customers.map((c) => ({
      key: c.id,
      label: c.name,
      icon: (
        <CustomerChip
          customerId={c.id}
          customerName={c.name}
          logoUrl={c.logo_url ?? null}
          size={14}
        />
      ),
      selected: selected?.id === c.id,
      labelClassName: "font-medium text-content truncate",
    })),
  ];

  return (
    <FilterChip
      icon={
        selected ? (
          <CustomerChip
            customerId={selected.id}
            customerName={selected.name}
            logoUrl={selected.logo_url ?? null}
            size={14}
          />
        ) : (
          <Building2 size={12} aria-hidden="true" />
        )
      }
      dimensionLabel={t("dimension")}
      valueLabel={selected ? selected.name : t("all")}
      valueClassName="truncate max-w-[180px]"
      listboxLabel={t("listboxLabel")}
      customized={selected !== null}
      panelClassName="w-[260px] max-h-[360px] overflow-auto"
      options={options}
      onPick={pick}
    />
  );
}
