"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Building2 } from "lucide-react";
import { CustomerChip } from "@/components/CustomerChip";

export interface CustomerFilterOption {
  id: string;
  name: string;
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
 */
export function CustomerFilter({
  customers,
  selectedId,
}: Props): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("common.customerFilter");

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (customers.length === 0) return null;

  const selected =
    selectedId !== null
      ? customers.find((c) => c.id === selectedId) ?? null
      : null;

  function pick(id: string | null): void {
    const params = new URLSearchParams(searchParams.toString());
    if (id === null) {
      params.delete("customer");
    } else {
      params.set("customer", id);
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium transition-colors border ${
          selected
            ? "bg-accent-soft text-accent-text border-accent/30"
            : "bg-surface-inset text-content-secondary border-edge hover:bg-hover"
        }`}
      >
        {selected ? (
          <CustomerChip
            customerId={selected.id}
            customerName={selected.name}
            size={14}
          />
        ) : (
          <Building2 size={12} aria-hidden="true" />
        )}
        <span className="truncate max-w-[180px]">
          {selected ? selected.name : t("all")}
        </span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("listboxLabel")}
          className="absolute z-20 mt-1 w-[260px] max-h-[360px] overflow-auto rounded-lg border border-edge bg-surface-raised shadow-lg p-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={selected === null}
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
          >
            <span className="w-3 shrink-0">
              {selected === null && <Check size={12} aria-hidden="true" />}
            </span>
            <span className="font-medium text-content">{t("all")}</span>
          </button>

          <div className="my-1 border-t border-edge-muted" />

          {customers.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={selected?.id === c.id}
              onClick={() => pick(c.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
            >
              <span className="w-3 shrink-0">
                {selected?.id === c.id && (
                  <Check size={12} aria-hidden="true" />
                )}
              </span>
              <CustomerChip
                customerId={c.id}
                customerName={c.name}
                size={14}
              />
              <span className="flex-1 min-w-0 truncate text-content">
                {c.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
