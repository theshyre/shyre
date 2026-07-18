"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CheckCircle, ChevronDown, Filter } from "lucide-react";
import {
  PROPOSAL_STATUS_FILTERS,
  type ProposalStatusFilter,
} from "@/lib/proposals/list-view";

/**
 * URL-driven status filter chip for the proposals list — same
 * dropdown-listbox pattern as the projects StatusFilter, with
 * proposal-shaped buckets: Sent folds in `viewed` ("in flight"),
 * History folds superseded + converted. Default = "all" (a proposal
 * list is short enough that the unfiltered view is the home view),
 * so `all` stays out of the URL.
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    setOpen(false);
  }

  const isCustomized = selected !== "all";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium border transition-colors ${
          isCustomized
            ? "bg-accent-soft text-accent-text border-accent/30"
            : "bg-surface-inset text-content-secondary border-edge hover:bg-hover"
        }`}
      >
        <Filter size={12} aria-hidden="true" />
        {t(`label.${selected}`)}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t("listboxLabel")}
          className="absolute left-0 top-full mt-1 w-[200px] rounded-lg border border-edge bg-surface-raised shadow-lg p-1 z-20"
        >
          {PROPOSAL_STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={selected === s}
              onClick={() => pick(s)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
            >
              <span className="w-3 shrink-0">
                {selected === s && (
                  <CheckCircle size={12} aria-hidden="true" />
                )}
              </span>
              <span className="text-content">{t(`label.${s}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
