"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Search,
  X,
  Calendar,
  Tag,
  FolderKanban,
  HelpCircle,
} from "lucide-react";
import Link from "next/link";
import { inputClass, selectClass, kbdClass } from "@/lib/form-styles";
import { Tooltip } from "@/components/Tooltip";
import { EXPENSE_CATEGORIES } from "./categories";
import {
  applyBillableFilter,
  applyProjectFilter,
  applyYearShortcut,
  buildExpenseFilterParams,
  deriveYearValue,
  hasActiveFilters,
  isCustomDateRange,
  parseExpenseFilters,
  toggleCategory as toggleCategoryFilter,
  type ExpenseFilters as Filters,
} from "./filter-params";
import type { ProjectOption } from "./page";

interface Props {
  /** Distinct YYYY strings of every expense in the business's
   *  scope, newest first. Drives the year dropdown options. */
  availableYears: string[];
  /** Active projects in the business's teams — drives the project
   *  filter dropdown. */
  projects: ProjectOption[];
  /** Server-side count of rows matching the current filter, BEFORE
   *  pagination clips. Drives the "N matches of M expenses"
   *  label so the badge stays accurate even when only the first
   *  50 rows are loaded. */
  matchingCount: number;
  /** Total expense count for the business across all years (no
   *  filter applied). The "universe" denominator. */
  totalCount: number;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Filter bar above the expenses table. URL-driven: every filter
 * change calls `router.replace` with updated searchParams; the
 * server component re-renders with filtered rows. Search is
 * debounced 250ms so we don't trip a server roundtrip per
 * keystroke.
 *
 * The bar exposes:
 *   - Free-text search (q) across vendor / description / notes
 *   - Year dropdown (built from availableYears) + custom from/to
 *     behind a "More filters" disclosure
 *   - Category multi-select chips ("Other" tinted warning)
 *   - Project dropdown (with "Unassigned" option)
 *   - Billable yes/no toggle
 *   - "Active filters" chip row with X-to-remove on each
 *   - Result count
 *
 * Slash key (/) focuses the search input — same shortcut as
 * other Shyre list pages.
 */
export function ExpenseFilters({
  availableYears,
  projects,
  matchingCount,
  totalCount,
}: Props): React.JSX.Element {
  const t = useTranslations("expenses");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Read the current URL into a Filters struct. Re-parsed on
  // every render — cheap, no need to memoize.
  const currentFilters = useMemo(
    () => parseExpenseFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );

  // Local search-input state lets us debounce updates without
  // controlled-input lag. Synced FROM the URL when external
  // navigation changes it (e.g., user clicks a "Clear all" chip
  // or hits the back button). React's "Adjusting state based on
  // props" pattern: track the previously-seen URL value in a
  // second piece of state and reset the draft inline during
  // render when the URL value changes. setState during render is
  // supported here — React discards the in-progress render and
  // re-runs with the synced value. Two useState calls (no ref)
  // keeps the react-hooks/refs lint rule happy.
  const [searchDraft, setSearchDraft] = useState(currentFilters.q);
  const [lastUrlQ, setLastUrlQ] = useState(currentFilters.q);
  if (currentFilters.q !== lastUrlQ) {
    setLastUrlQ(currentFilters.q);
    setSearchDraft(currentFilters.q);
  }

  /** Push filter state to the URL. Replace (not push) so the
   *  back button doesn't get spammed with every keystroke. */
  const pushFilters = useCallback(
    (next: Filters) => {
      const sp = buildExpenseFilterParams(next);
      const qs = sp.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [pathname, router],
  );

  // Debounce search → URL.
  useEffect(() => {
    if (searchDraft === currentFilters.q) return;
    const id = window.setTimeout(() => {
      pushFilters({ ...currentFilters, q: searchDraft });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchDraft, currentFilters, pushFilters]);

  // / focuses the search input — common Shyre convention. Disabled
  // when the user is already typing in a text field.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "/") return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Filter mutators ─────────────────────────────────────────

  const setYear = (year: string): void => {
    pushFilters(applyYearShortcut(currentFilters, year));
  };

  const toggleCategory = (cat: string): void => {
    pushFilters(toggleCategoryFilter(currentFilters, cat));
  };

  const setProject = (project: string): void => {
    pushFilters(applyProjectFilter(currentFilters, project));
  };

  const setBillable = (raw: string): void => {
    pushFilters(applyBillableFilter(currentFilters, raw));
  };

  const setDate = (key: "from" | "to", value: string): void => {
    pushFilters({ ...currentFilters, [key]: value || null });
  };

  const clearAll = (): void => {
    setSearchDraft("");
    pushFilters({
      q: "",
      from: null,
      to: null,
      categories: [],
      project: null,
      billable: null,
    });
  };

  // Year dropdown current value (pure helper).
  const yearValue = deriveYearValue(currentFilters);
  const [moreOpen, setMoreOpen] = useState(
    isCustomDateRange(currentFilters),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-[420px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted"
          />
          <input
            ref={searchRef}
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            aria-label={t("filters.search")}
            className={`${inputClass} pl-8 pr-12`}
          />
          <kbd
            className={`${kbdClass} absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none`}
          >
            /
          </kbd>
        </div>

        {/* Year */}
        <div className="inline-flex items-center gap-1">
          <Calendar size={12} className="text-content-muted" />
          <select
            value={yearValue}
            onChange={(e) => setYear(e.target.value)}
            aria-label={t("filters.year")}
            className={selectClass}
            style={{ width: 130 }}
          >
            <option value="">{t("filters.allYears")}</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Project */}
        <div className="inline-flex items-center gap-1">
          <FolderKanban size={12} className="text-content-muted" />
          <select
            value={currentFilters.project ?? ""}
            onChange={(e) => setProject(e.target.value)}
            aria-label={t("fields.project")}
            className={selectClass}
            style={{ width: 180 }}
          >
            <option value="">{t("filters.allProjects")}</option>
            <option value="none">{t("filters.unassigned")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Billable */}
        <select
          value={
            currentFilters.billable === null
              ? ""
              : String(currentFilters.billable)
          }
          onChange={(e) => setBillable(e.target.value)}
          aria-label={t("fields.billable")}
          className={selectClass}
          style={{ width: 150 }}
        >
          <option value="">{t("filters.anyBillable")}</option>
          <option value="true">{t("filters.billableOnly")}</option>
          <option value="false">{t("filters.nonBillableOnly")}</option>
        </select>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="text-caption text-content-secondary hover:text-content underline-offset-2 hover:underline"
        >
          {moreOpen ? t("filters.lessFilters") : t("filters.moreFilters")}
        </button>

        <span className="ml-auto text-caption text-content-muted">
          {t("filters.resultCount", {
            hasFilter: hasActiveFilters(currentFilters) ? "true" : "false",
            shown: matchingCount,
            total: totalCount,
          })}
        </span>
      </div>

      {/* Category chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Tag size={12} className="text-content-muted shrink-0" />
        <Tooltip label={t("categoryDocsHint")} labelMode="label">
          <Link
            href="/docs/guides/features/expense-categories"
            className="inline-flex items-center text-content-muted hover:text-content"
            aria-label={t("categoryDocsHint")}
          >
            <HelpCircle size={12} />
          </Link>
        </Tooltip>
        {EXPENSE_CATEGORIES.map((c) => {
          const active = currentFilters.categories.includes(c);
          const isOtherWarning = c === "other";
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              aria-pressed={active}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium transition-colors ${
                active
                  ? isOtherWarning
                    ? "border-warning bg-warning text-content-inverse"
                    : "border-accent bg-accent text-accent-text"
                  : isOtherWarning
                    ? "border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft/70"
                    : "border-edge bg-surface-raised text-content-secondary hover:bg-hover"
              }`}
            >
              {t(`categories.${c}`)}
            </button>
          );
        })}
      </div>

      {/* Custom date range — disclosed via "More filters" */}
      {moreOpen && (
        <div className="flex items-center gap-2 flex-wrap rounded-md border border-edge-muted bg-surface px-3 py-2">
          <span className="text-caption text-content-muted">
            {t("filters.customRange")}
          </span>
          <input
            type="date"
            value={currentFilters.from ?? ""}
            onChange={(e) => setDate("from", e.target.value)}
            aria-label={t("filters.from")}
            className={inputClass}
            style={{ width: 160 }}
          />
          <span className="text-caption text-content-muted">→</span>
          <input
            type="date"
            value={currentFilters.to ?? ""}
            onChange={(e) => setDate("to", e.target.value)}
            aria-label={t("filters.to")}
            className={inputClass}
            style={{ width: 160 }}
          />
        </div>
      )}

      {/* Active filter chips + Clear all */}
      {hasActiveFilters(currentFilters) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-caption text-content-muted">
            {t("filters.active")}
          </span>
          {currentFilters.q && (
            <ActiveChip
              label={`${t("filters.search")}: "${currentFilters.q}"`}
              onRemove={() => {
                setSearchDraft("");
                pushFilters({ ...currentFilters, q: "" });
              }}
            />
          )}
          {yearValue && (
            <ActiveChip
              label={`${t("filters.year")}: ${yearValue}`}
              onRemove={() => setYear("")}
            />
          )}
          {!yearValue && currentFilters.from && (
            <ActiveChip
              label={`${t("filters.from")}: ${currentFilters.from}`}
              onRemove={() => setDate("from", "")}
            />
          )}
          {!yearValue && currentFilters.to && (
            <ActiveChip
              label={`${t("filters.to")}: ${currentFilters.to}`}
              onRemove={() => setDate("to", "")}
            />
          )}
          {currentFilters.categories.map((c) => (
            <ActiveChip
              key={c}
              label={t(`categories.${c}`)}
              onRemove={() => toggleCategory(c)}
            />
          ))}
          {currentFilters.project === "none" && (
            <ActiveChip
              label={t("filters.unassigned")}
              onRemove={() => setProject("")}
            />
          )}
          {currentFilters.project !== null &&
            currentFilters.project !== "none" && (
              <ActiveChip
                label={
                  projects.find((p) => p.id === currentFilters.project)
                    ?.name ?? t("fields.project")
                }
                onRemove={() => setProject("")}
              />
            )}
          {currentFilters.billable === true && (
            <ActiveChip
              label={t("filters.billableOnly")}
              onRemove={() => setBillable("")}
            />
          )}
          {currentFilters.billable === false && (
            <ActiveChip
              label={t("filters.nonBillableOnly")}
              onRemove={() => setBillable("")}
            />
          )}
          <Tooltip label={t("filters.clearAll")} labelMode="label">
            <button
              type="button"
              onClick={clearAll}
              className="ml-1 text-caption text-content-secondary hover:text-content underline-offset-2 hover:underline"
            >
              {t("filters.clearAll")}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function ActiveChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-raised px-2 py-0.5 text-caption text-content-secondary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="inline-flex items-center text-content-muted hover:text-content"
      >
        <X size={10} />
      </button>
    </span>
  );
}
