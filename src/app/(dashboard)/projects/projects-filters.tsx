"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, CheckCircle, Users } from "lucide-react";
import { FilterChip, type FilterChipOption } from "@/components/FilterChip";
import { ListSearchInput } from "@/components/ListSearchInput";
import { CustomerChip } from "@theshyre/ui";

interface CustomerOption {
  id: string;
  name: string;
  logo_url?: string | null;
}

const STATUS_KEYS = [
  "all",
  "active",
  "paused",
  "completed",
  "archived",
] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

/**
 * URL-driven status filter chip. Each named status pins to exactly
 * that status (Active = active, Completed = completed, …); "All" shows
 * every status. Default = "active" (matches the page's default).
 */
export function StatusFilter({
  selected,
}: {
  selected: StatusKey;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters.status");

  function pick(next: StatusKey): void {
    const params = new URLSearchParams(searchParams.toString());
    // "active" is the default and gets stripped from the URL so a
    // bookmarked /projects link without ?status= still lands on the
    // expected default, and the URL stays clean.
    if (next === "active") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    // Reset pagination — a narrower filter with an inherited big
    // `limit` would silently over-fetch (list-pages.md rule 1).
    params.delete("limit");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <FilterChip<StatusKey>
      icon={<CheckCircle size={12} aria-hidden="true" />}
      dimensionLabel={t("dimension")}
      valueLabel={t(`label.${selected}`)}
      listboxLabel={t("listboxLabel")}
      customized={selected !== "active"}
      panelClassName="w-[180px]"
      options={STATUS_KEYS.map((s) => ({
        key: s,
        label: t(`label.${s}`),
        selected: selected === s,
      }))}
      onPick={pick}
    />
  );
}

export type CustomerFilterSelection =
  | { kind: "all" }
  | { kind: "internal" }
  | { kind: "id"; id: string };

/**
 * URL-driven customer filter — picks a single customer (or
 * "Internal projects only", or "All customers"). Single-select
 * keeps the picker tight; multi-select is a future ask if real
 * users need it.
 */
export function CustomerFilter({
  selection,
  customers,
}: {
  selection: CustomerFilterSelection;
  customers: CustomerOption[];
}): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters.customer");

  if (customers.length === 0) return null;

  function pick(key: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "all") {
      params.delete("customer");
    } else {
      // "internal" and customer ids share the ?customer= param.
      params.set("customer", key);
    }
    // Reset pagination — a narrower filter with an inherited big
    // `limit` would silently over-fetch (list-pages.md rule 1).
    params.delete("limit");
    router.push(`${pathname}?${params.toString()}`);
  }

  const label = (() => {
    if (selection.kind === "all") return t("label.all");
    if (selection.kind === "internal") return t("label.internal");
    return (
      customers.find((c) => c.id === selection.id)?.name ??
      t("label.unknown")
    );
  })();

  const options: FilterChipOption[] = [
    {
      key: "all",
      label: t("label.all"),
      icon: (
        <Users size={12} className="text-content-muted" aria-hidden="true" />
      ),
      selected: selection.kind === "all",
      labelClassName: "font-medium text-content",
    },
    {
      key: "internal",
      label: t("label.internal"),
      icon: (
        <Building2
          size={12}
          className="text-content-muted"
          aria-hidden="true"
        />
      ),
      selected: selection.kind === "internal",
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
      selected: selection.kind === "id" && selection.id === c.id,
      labelClassName: "font-medium text-content truncate",
    })),
  ];

  return (
    <FilterChip
      icon={
        selection.kind === "internal" ? (
          <Building2 size={12} aria-hidden="true" />
        ) : (
          <Users size={12} aria-hidden="true" />
        )
      }
      dimensionLabel={t("dimension")}
      valueLabel={label}
      valueClassName="truncate max-w-[160px]"
      listboxLabel={t("listboxLabel")}
      customized={selection.kind !== "all"}
      panelClassName="w-[260px] max-h-[360px] overflow-auto"
      options={options}
      onPick={pick}
    />
  );
}

/**
 * Free-text search box for project names, on the shared
 * <ListSearchInput> primitive: 300ms debounced instant-apply, Enter
 * commits immediately, Escape clears, `/` focuses (with kbd hint).
 */
export function ProjectSearchInput({
  initialQuery,
}: {
  initialQuery: string;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters.search");

  const commit = useCallback(
    (next: string): void => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.length === 0) {
        params.delete("q");
      } else {
        params.set("q", next);
      }
      // Reset pagination — a narrower filter with an inherited big
      // `limit` would silently over-fetch (list-pages.md rule 1).
      params.delete("limit");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <ListSearchInput
      value={initialQuery}
      onCommit={commit}
      placeholder={t("placeholder")}
      ariaLabel={t("ariaLabel")}
    />
  );
}

/**
 * Visual hint surfaced below the toolbar when one or more filters
 * are active AND the result set is empty — gives the user a quick
 * way to clear the offending filters and try again.
 */
export function ProjectFiltersClearHint({
  active,
}: {
  active: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters");
  if (!active) return null;
  function clearAll(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("customer");
    params.delete("q");
    // Changing any filter resets `limit` (list-pages.md rule 1) —
    // clearing them all is no exception.
    params.delete("limit");
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <div className="mt-3 inline-flex items-center gap-2 text-caption text-content-muted">
      <span>{t("noResultsHint")}</span>
      <button
        type="button"
        onClick={clearAll}
        className="text-accent hover:underline"
      >
        {t("clearAll")}
      </button>
    </div>
  );
}
