"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { EntryGroup } from "@/lib/time/grouping";
import {
  formatDurationHM,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import { DateField } from "@/components/DateField";
import { ListSearchInput } from "@/components/ListSearchInput";
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
  /** Viewer timezone offset — forwarded to the inline edit form so
   *  date math matches the other views. */
  tzOffsetMin: number;
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
  tzOffsetMin,
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

  // Search state (draft, 300ms debounce, Enter commit, Escape clear)
  // lives inside <ListSearchInput> — the one list-page search
  // primitive (docs/reference/list-pages.md rule 1). This component
  // only owns the committed-query → URL write.
  const commitSearch = useCallback(
    (next: string) => patchUrl({ q: next }),
    [patchUrl],
  );

  // Selection count reported up by EntryTable — folded into the
  // page's single polite live region below.
  const [selectedCount, setSelectedCount] = useState(0);

  // Row expansion → InlineEditForm, same client-state pattern as the
  // Log view (feedback: expandable rows, not drawers). This was a
  // `() => {}` stub when the Table view shipped — row click and
  // kebab-Edit silently did nothing.
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const toggleExpanded = useCallback(
    (id: string) =>
      setExpandedEntryId((current) => (current === id ? null : id)),
    [],
  );

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

  // ONE polite live region for the view (list-pages.md a11y
  // invariants): announces the result count after a filter commit
  // and "N selected" on selection change. Debounced so rapid
  // checkbox toggles or keystroke-driven refetches don't spam AT.
  const [liveMessage, setLiveMessage] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setLiveMessage(
        selectedCount > 0
          ? t("live.selected", { count: selectedCount })
          : t("live.results", { count: entries.length }),
      );
    }, 300);
    return () => clearTimeout(id);
  }, [selectedCount, entries.length, t]);

  return (
    <div className="space-y-3">
      {/* Row 3 — filters as plain toolbar-row citizens (list-pages.md
          rule 1: no boxed FILTERS panel). Labeled DateField pair +
          invoice-status segmented control on the left; search + Clear
          all sit at the row's end. Wraps onto extra lines at narrow
          viewports. */}
      <div
        role="search"
        className="flex flex-wrap items-end gap-3"
        aria-label={t("filterRegion")}
      >
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
        <div className="ml-auto flex items-center gap-3 self-end pb-0.5">
          <ListSearchInput
            value={searchQuery ?? ""}
            onCommit={commitSearch}
            placeholder={t("searchPlaceholder")}
            ariaLabel={t("search")}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() =>
                patchUrl({
                  q: "",
                  invoiced: "",
                  from: "",
                  to: "",
                })
              }
              className="text-caption text-content-secondary hover:text-content hover:underline"
            >
              {t("clearAll")}
            </button>
          )}
        </div>
      </div>

      {/* The view's one polite live region — visually hidden; the
          visible result summary below carries the same numbers for
          sighted users. */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
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
        expandedEntryId={expandedEntryId}
        onToggleExpand={toggleExpanded}
        hideGroupHeaders
        viewerUserId={viewerUserId}
        tzOffsetMin={tzOffsetMin}
        showDate
        onSelectionCountChange={setSelectedCount}
      />
    </div>
  );
}
