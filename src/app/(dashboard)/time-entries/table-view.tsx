"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X, AlertTriangle } from "lucide-react";
import type { EntryGroup } from "@/lib/time/grouping";
import {
  formatDurationHM,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import { DateField } from "@/components/DateField";
import { inputClass } from "@/lib/form-styles";
import { EntryTable } from "./entry-table";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

/** URL value space for the invoice-status filter chip group. Kept
 *  string-literal so the chip array can iterate without forcing a
 *  cast. Mirrors `TableInvoicedFilter` in page.tsx — that file is the
 *  ground truth for the URL contract; this type is the client-side
 *  view of the same alphabet. */
export type TableInvoicedFilter =
  | "all"
  | "uninvoiced"
  | "invoiced"
  | "billed_elsewhere";

const INVOICED_OPTIONS: TableInvoicedFilter[] = [
  "all",
  "uninvoiced",
  "invoiced",
  "billed_elsewhere",
];

interface Props {
  /** Entries returned by the server, already filtered by date / search /
   *  status / member / project. Pre-sorted DESC by start_time. */
  entries: TimeEntry[];
  /** Resolved date range that produced `entries` — used by the
   *  filter row and the empty-state copy ("No entries between X and
   *  Y match your search"). Always set (server resolves defaults). */
  fromStr: string;
  toStr: string;
  /** Active description-search query, or null when none is set. */
  searchQuery: string | null;
  /** Active invoice-status filter ("all" when not narrowed). */
  invoicedFilter: TableInvoicedFilter;
  /** Server-side row cap. When `entries.length` equals this, the
   *  table renders a "truncated — narrow the range" notice so the
   *  user understands they're not seeing the full set. */
  rowLimit: number;
  projects: ProjectOption[];
  categories: CategoryOption[];
  /** auth.uid() of the viewer — forwarded to EntryRow for the ticket
   *  refresh affordance. */
  viewerUserId: string;
}

/**
 * Admin / review view. Flat list, sorted start_time DESC, with date
 * range + description search + invoice-status filter. Reuses the
 * shared `EntryTable` so bulk-select / delete / mark-billed-elsewhere
 * work without divergence from Week / Day / Log.
 *
 * The three time-horizon views (Week / Day / Log) and this one
 * deliberately don't share the time-views parity rule — date-range
 * picking and description search are nonsensical on a grid or on
 * "today." This is the *task lens*, not the *time lens*.
 */
export function TableView({
  entries,
  fromStr,
  toStr,
  searchQuery,
  invoicedFilter,
  rowLimit,
  projects,
  categories,
  viewerUserId,
}: Props): React.JSX.Element {
  const t = useTranslations("time.table");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Push a URL update with the supplied key→value patches. Empty
   *  string values are interpreted as "delete this param" so callers
   *  can pass `q: ""` to clear the search box. */
  const patchUrl = useCallback(
    (patches: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patches)) {
        if (v === "") params.delete(k);
        else params.set(k, v);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Local search-input state — committed to the URL on Enter or after
  // 300ms of idle. Without the debounce every keystroke would
  // re-fetch the entry list, which on the free Supabase tier means
  // ~150ms of round-trip per keystroke and a thrashy table. Seeded
  // from the URL on mount; the URL → local sync on prop change is
  // intentionally absent — the debounce is the only thing that
  // closes the loop, and an extra sync would yank the user's cursor
  // mid-edit when the URL update comes back. Callers that need to
  // *clear* the search (Clear-all button, Esc key) reset both local
  // state and URL in the same click handler.
  const [searchInput, setSearchInput] = useState<string>(searchQuery ?? "");

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (searchQuery ?? "")) return;
    const id = setTimeout(() => {
      patchUrl({ q: trimmed });
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, searchQuery, patchUrl]);

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      patchUrl({ q: searchInput.trim() });
    } else if (e.key === "Escape" && searchInput.length > 0) {
      e.preventDefault();
      setSearchInput("");
      patchUrl({ q: "" });
    }
  };

  // Single synthetic group — EntryTable wants groups, but here we
  // want a flat list. `hideGroupHeaders` keeps the group's label /
  // total from rendering; the masthead above the table carries those
  // numbers instead.
  const groups: EntryGroup<TimeEntry>[] = useMemo(
    () => [
      {
        id: "table-all",
        label: t("groupLabel"),
        entries,
        totalMin: sumDurationMin(entries),
        billableMin: sumBillableMin(entries),
      },
    ],
    [entries, t],
  );

  const totalMin = sumDurationMin(entries);
  const billableMin = sumBillableMin(entries);
  const nonBillableMin = totalMin - billableMin;
  const truncated = entries.length >= rowLimit;
  const hasFilters =
    Boolean(searchQuery) ||
    invoicedFilter !== "all" ||
    // Any custom date range counts as a "filter" for the Clear-all
    // affordance; the page's default is the last 30 days, but the
    // user can't tell from the URL alone, so we treat any explicit
    // ?from or ?to as a narrowed state.
    Boolean(searchParams.get("from")) ||
    Boolean(searchParams.get("to"));

  return (
    <div className="space-y-3">
      {/* Filter row — date range on the left, search center, invoice-
          status chips on the right. Wraps onto a second line at narrow
          viewports without the surrounding card breaking apart. */}
      <div
        className="rounded-md border border-edge bg-surface-inset p-3"
        aria-label={t("filterRegion")}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("from")}
            </span>
            <DateField
              value={fromStr}
              onChange={(next) =>
                patchUrl({ from: next })
              }
              ariaLabel={t("from")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-label font-semibold uppercase tracking-wider text-content-muted">
              {t("to")}
            </span>
            <DateField
              value={toStr}
              onChange={(next) =>
                patchUrl({ to: next })
              }
              ariaLabel={t("to")}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[12rem] flex-1">
            <label
              className="text-label font-semibold uppercase tracking-wider text-content-muted"
              htmlFor="table-search"
            >
              {t("search")}
            </label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="table-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder={t("searchPlaceholder")}
                className={`${inputClass} pl-7 pr-7`}
              />
              {searchInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    patchUrl({ q: "" });
                  }}
                  aria-label={t("clearSearch")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-content-muted hover:text-content hover:bg-hover"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div
            role="group"
            aria-label={t("invoicedFilter.label")}
            className="flex items-end gap-1"
          >
            <div className="flex flex-col gap-1">
              <span className="text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("invoicedFilter.label")}
              </span>
              <div className="inline-flex rounded-md border border-edge overflow-hidden">
                {INVOICED_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      patchUrl({ invoiced: opt === "all" ? "" : opt })
                    }
                    aria-pressed={invoicedFilter === opt}
                    className={`px-2.5 py-1 text-caption font-medium transition-colors ${
                      invoicedFilter === opt
                        ? "bg-accent text-content-inverse"
                        : "bg-surface-raised text-content-secondary hover:bg-hover"
                    }`}
                  >
                    {t(`invoicedFilter.${opt}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                patchUrl({
                  q: "",
                  invoiced: "",
                  from: "",
                  to: "",
                });
              }}
              className="text-caption text-content-secondary hover:text-content hover:underline self-end pb-1"
            >
              {t("clearAll")}
            </button>
          )}
        </div>
      </div>

      {/* Result summary — entry count + hours total + billable split.
          Visible above the table so the user always knows how big the
          current filter is before they bulk-act on it. */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-body-lg font-semibold text-content">
          {t("resultCount", { count: entries.length })}
        </span>
        <span className="text-body text-content-secondary font-mono tabular-nums">
          {t("totals", {
            total: formatDurationHM(totalMin),
            billable: formatDurationHM(billableMin),
            nonBillable: formatDurationHM(nonBillableMin),
          })}
        </span>
        <span className="text-caption text-content-muted ml-auto">
          {t("rangeCaption", { from: fromStr, to: toStr })}
        </span>
      </div>

      {truncated && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-caption text-warning-text"
        >
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{t("truncated", { limit: rowLimit })}</span>
        </div>
      )}

      <EntryTable
        groups={groups}
        projects={projects}
        categories={categories}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
        viewerUserId={viewerUserId}
        showDate
      />
    </div>
  );
}
