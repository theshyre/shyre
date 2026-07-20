"use client";

import { useTranslations } from "next-intl";
import {
  hasActiveInvoiceFilters,
  type InvoiceListFilters,
} from "./invoice-list-filters";
export { hasActiveInvoiceFilters, type InvoiceListFilters } from "./invoice-list-filters";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CheckCircle, Users } from "lucide-react";
import { FilterChip, type FilterChipOption } from "@/components/FilterChip";
import { CustomerChip } from "@theshyre/ui";
import { DateField } from "@/components/DateField";
import {
  INVOICE_STATUSES,
  type InvoiceStatus,
} from "@/lib/invoice-status";

/**
 * Row-3 filters for the invoice list, on the canonical list-page
 * grammar (docs/reference/list-pages.md rule 1): inline chips +
 * a labeled DateField pair, all instant-apply via URL push — no
 * boxed panel, no Apply button. Default values are stripped from
 * the URL; every change resets `?limit=` so "Load more" state
 * never leaks across filter changes.
 */

interface CustomerOption {
  id: string;
  name: string;
  logo_url?: string | null;
}



/** Sentinel for "no filter" — statuses are a closed lowercase set and
 *  customer ids are UUIDs, so this can never collide. */
const ALL_KEY = "__all";

function usePatchInvoiceUrl(): (
  patch: Partial<Record<"status" | "customerId" | "from" | "to", string>>,
) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (patch) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    // Any filter change resets the load-more window.
    params.delete("limit");
    router.push(`${pathname}?${params.toString()}`);
  };
}

/** Status chip — "Any status" (default, stripped from the URL) or one
 *  of the five invoice statuses. */
export function InvoiceStatusFilter({
  selected,
}: {
  selected: InvoiceStatus | null;
}): React.JSX.Element {
  const t = useTranslations("invoices.filters.status");
  const tStatus = useTranslations("invoices.status");
  const patchUrl = usePatchInvoiceUrl();

  return (
    <FilterChip
      icon={<CheckCircle size={12} aria-hidden="true" />}
      dimensionLabel={t("dimension")}
      valueLabel={selected ? tStatus(selected) : t("all")}
      listboxLabel={t("listboxLabel")}
      customized={selected !== null}
      panelClassName="w-[180px]"
      options={[
        { key: ALL_KEY, label: t("all"), selected: selected === null },
        ...INVOICE_STATUSES.map((s) => ({
          key: s,
          label: tStatus(s),
          selected: selected === s,
        })),
      ]}
      onPick={(key) => patchUrl({ status: key === ALL_KEY ? "" : key })}
    />
  );
}

/** Customer chip — "Any customer" (default, stripped) or a single
 *  customer, with the CustomerChip identity-mark on each option. */
export function InvoiceCustomerFilter({
  selectedCustomerId,
  customers,
}: {
  selectedCustomerId: string | null;
  customers: CustomerOption[];
}): React.JSX.Element | null {
  const t = useTranslations("invoices.filters.customer");
  const patchUrl = usePatchInvoiceUrl();

  if (customers.length === 0) return null;

  const selectedName = selectedCustomerId
    ? (customers.find((c) => c.id === selectedCustomerId)?.name ??
      t("unknown"))
    : t("all");

  const options: FilterChipOption[] = [
    {
      key: ALL_KEY,
      label: t("all"),
      icon: (
        <Users size={12} className="text-content-muted" aria-hidden="true" />
      ),
      selected: selectedCustomerId === null,
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
      selected: selectedCustomerId === c.id,
      labelClassName: "font-medium text-content truncate",
    })),
  ];

  return (
    <FilterChip
      icon={<Users size={12} aria-hidden="true" />}
      dimensionLabel={t("dimension")}
      valueLabel={selectedName}
      valueClassName="truncate max-w-[160px]"
      listboxLabel={t("listboxLabel")}
      customized={selectedCustomerId !== null}
      panelClassName="w-[260px] max-h-[360px] overflow-auto"
      options={options}
      onPick={(key) => patchUrl({ customerId: key === ALL_KEY ? "" : key })}
    />
  );
}

/** Labeled issued-date range pair. Instant-apply like the chips; an
 *  empty value strips the param. */
export function InvoiceIssuedDateFilter({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}): React.JSX.Element {
  const t = useTranslations("invoices.filters");
  const patchUrl = usePatchInvoiceUrl();

  // Constrain each date field to just enough for MM/DD/YYYY + the icon.
  // Without a width the shared DateField is w-full and balloons across
  // the filter row (crowding the chips). rem so it tracks text-size.
  const dateFieldWidth = "w-[9.5rem]";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <label
        htmlFor="invoice-filter-from"
        className="text-caption text-content-muted whitespace-nowrap"
      >
        {t("from")}
      </label>
      <DateField
        id="invoice-filter-from"
        className={dateFieldWidth}
        value={from ?? ""}
        onChange={(next) => patchUrl({ from: next })}
      />
      <label
        htmlFor="invoice-filter-to"
        className="text-caption text-content-muted whitespace-nowrap"
      >
        {t("to")}
      </label>
      <DateField
        id="invoice-filter-to"
        className={dateFieldWidth}
        value={to ?? ""}
        onChange={(next) => patchUrl({ to: next })}
      />
    </div>
  );
}



/** Ghost "Clear all" link at the end of the filter row — rendered only
 *  while at least one filter is off its default. Keeps `?org=` (the
 *  team scope has its own "All" affordance in the TeamFilter chip). */
export function InvoiceFiltersClearAll({
  filters,
}: {
  filters: InvoiceListFilters;
}): React.JSX.Element | null {
  const t = useTranslations("invoices.filters");
  const patchUrl = usePatchInvoiceUrl();

  if (!hasActiveInvoiceFilters(filters)) return null;

  return (
    <button
      type="button"
      onClick={() =>
        patchUrl({ status: "", customerId: "", from: "", to: "" })
      }
      className="text-caption text-content-secondary hover:text-content hover:underline"
    >
      {t("clearAll")}
    </button>
  );
}

/** Hint below a filtered-empty table: names the situation and offers
 *  the one-click way out (mirrors projects' ProjectFiltersClearHint). */
export function InvoiceFiltersNoResultsHint({
  active,
}: {
  active: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("invoices.filters");
  const patchUrl = usePatchInvoiceUrl();

  if (!active) return null;

  return (
    <div className="mt-3 inline-flex items-center gap-2 text-caption text-content-muted">
      <span>{t("noResultsHint")}</span>
      <button
        type="button"
        onClick={() =>
          patchUrl({ status: "", customerId: "", from: "", to: "" })
        }
        className="text-accent hover:underline"
      >
        {t("clearAll")}
      </button>
    </div>
  );
}
