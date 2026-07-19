"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  Building2,
  CircleCheck,
  FolderKanban,
  FolderTree,
  XCircle,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { formatCurrency } from "@/lib/invoice-utils";
import { CustomerChip } from "@theshyre/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { OverdueBadge } from "@/components/OverdueBadge";
import { SortableTableHeader } from "@/components/SortableTableHeader";
import { PaginationFooter } from "@/components/PaginationFooter";
import { isProjectOverdue } from "@/lib/projects/lifecycle";
import { isTextEditingTarget } from "@/lib/is-text-editing-target";
import { checkboxClass } from "@/lib/form-styles";
import {
  bulkStripButtonClass,
  bulkStripDangerButtonClass,
  tableClass,
  tableHeaderCellClass,
  tableHeaderRowClass,
  tableBodyRowClass,
  tableBodyCellClass,
  tableWrapperClass,
} from "@/lib/table-styles";
import {
  bulkArchiveProjectsAction,
  bulkRestoreProjectsAction,
  bulkSwitchCategorySetAction,
  bulkCloseProjectsAction,
  bulkReopenProjectsAction,
} from "./actions";

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
  hourly_rate: number | null;
  status: string | null;
  /** Projected end date (ISO YYYY-MM-DD) or null. Drives the inline
   *  "overdue" badge in the status cell when the project is still live
   *  (active/paused) and the date has passed. */
  projected_end_date: string | null;
  is_internal: boolean;
  /** When set, this row is a sub-project. The list renders it
   *  immediately below its parent with an indented label so the
   *  hierarchy is visible at a glance. */
  parent_project_id: string | null;
  customers: { id: string; name: string; logo_url: string | null } | null;
}

interface CategorySetOption {
  id: string;
  name: string;
  is_system: boolean;
}

interface Props {
  projects: ProjectRow[];
  totalCount: number;
  /** team_id → display name; size>1 enables the Org column. */
  teamNameById: Map<string, string>;
  /** "name" | "hourly_rate" | "status" | "created_at" — current
   *  server-resolved sort key. */
  sort: string;
  dir: "asc" | "desc";
  /** Plain-string params to preserve across sort clicks. The server
   *  page can't pass a closure across the server/client boundary
   *  (Next.js refuses unmarked functions), so we accept the raw
   *  inputs and build the URL inside the client component. */
  selectedTeamId?: string;
  limitParam?: string;
  /** Category sets the caller can pick from in the bulk-switch
   *  toolbar action. Includes both system and team-shared sets. */
  categorySets?: CategorySetOption[];
  /** Per-project current-period burn % — rendered as the colored
   *  progress bar for budgeted projects. Computed server-side. */
  periodBurnPctById?: Record<string, number | null>;
  /** Per-project trailing-90-day total in MINUTES — the no-budget
   *  cell renders "Nh · 90d" when this is > 0 (and there's no period
   *  burn for the project). The minutes-level granularity lives in
   *  the wire format so the client can decide its own rounding
   *  (currently nearest hour for visual density). Computed server-
   *  side; absent map / undefined value renders an em-dash. */
  noBudgetMinById?: Record<string, number>;
}

/**
 * Multi-select projects table — Pattern B.
 *
 * Same shape as /customers: sibling bulk strip above the <table>
 * with master checkbox + per-row checkbox + Escape-to-clear.
 * Sortable headers are preserved (server-rendered URL navigation
 * via SortableTableHeader still owns the sort link contract).
 *
 * Bulk action: archive (status='archived'). Undo toast restores
 * to status='active'.
 */
export function ProjectsTable({
  projects,
  totalCount,
  teamNameById,
  sort,
  dir,
  selectedTeamId,
  limitParam,
  categorySets = [],
  periodBurnPctById = {},
  noBudgetMinById = {},
}: Props): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  // Tier-1 inline confirm for the bulk close-out — closing is a
  // reversible one-way flip (list-pages.md rule 5), so the Close
  // button arms an inline [Confirm][Cancel] pair instead of acting
  // immediately. Armed state is keyed on a snapshot of the selected
  // ids: if the selection changes, the key no longer matches and the
  // confirm disarms by derivation (no setState-in-effect) — a confirm
  // armed for one set of projects can never fire against another.
  const [closeArmedKey, setCloseArmedKey] = useState<string | null>(null);
  const setPickerRef = useRef<HTMLDivElement>(null);
  const setPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const closeConfirmRef = useRef<HTMLButtonElement>(null);

  // Close the bulk-switch dropdown on outside-click. Hooked
  // unconditionally so the call count stays stable between the
  // open and closed paths.
  useEffect(() => {
    if (!setPickerOpen) return;
    function handleClick(e: MouseEvent): void {
      if (
        setPickerRef.current &&
        !setPickerRef.current.contains(e.target as Node)
      ) {
        setSetPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [setPickerOpen]);

  // Escape closes the bulk-switch dropdown AND returns focus to its
  // trigger. Capture phase + stopPropagation so the consumed keypress
  // never reaches the page-level "clear selection" handler below —
  // an open panel is the more specific overlay (list-pages.md rule 5).
  useEffect(() => {
    if (!setPickerOpen) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setSetPickerOpen(false);
      setPickerTriggerRef.current?.focus();
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [setPickerOpen]);

  const buildSortHref = useCallback(
    ({ sort: nextSort, dir: nextDir }: { sort: string; dir: "asc" | "desc" }) => {
      const params = new URLSearchParams();
      if (selectedTeamId) params.set("org", selectedTeamId);
      if (limitParam) params.set("limit", limitParam);
      params.set("sort", nextSort);
      params.set("dir", nextDir);
      return `/projects?${params.toString()}`;
    },
    [selectedTeamId, limitParam],
  );

  const showTeamColumn = teamNameById.size > 1;
  // Budget column is ALWAYS visible — for at-a-glance scanning, the
  // user wants the column slot reserved whether or not a project has
  // a recurring cap configured. Projects without a budget render as
  // an em-dash (BurnCell handles `null`). Previously gated behind
  // "at least one visible project has a numeric burn"; that hid the
  // affordance entirely for users who hadn't set up any recurring
  // budget yet — including the prompt to set one.
  const showBurnColumn = true;
  const selectedCount = selected.size;
  const allSelected = projects.length > 0 && selectedCount === projects.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // Re-order to put each child immediately after its parent so the
  // hierarchy is visually contiguous. Top-level projects keep the
  // server-resolved sort order; children stay in their server-
  // sorted order within their parent group. When a child's parent
  // isn't in the visible page (filtered / paginated out), the
  // child renders as a top-level row to avoid disappearing entirely.
  const orderedProjects = useMemo(() => {
    const visibleIds = new Set(projects.map((p) => p.id));
    const childrenByParent = new Map<string, ProjectRow[]>();
    const tops: ProjectRow[] = [];
    for (const p of projects) {
      if (p.parent_project_id && visibleIds.has(p.parent_project_id)) {
        const arr = childrenByParent.get(p.parent_project_id) ?? [];
        arr.push(p);
        childrenByParent.set(p.parent_project_id, arr);
      } else {
        tops.push(p);
      }
    }
    const out: ProjectRow[] = [];
    for (const p of tops) {
      out.push(p);
      const kids = childrenByParent.get(p.id);
      if (kids) out.push(...kids);
    }
    return out;
  }, [projects]);

  // Bucket the parent-then-child sequence into customer groups for
  // the visual treatment. Sub-projects share their parent's customer
  // (trigger-enforced) so the parent → child contiguity is preserved
  // when we iterate orderedProjects in order.
  //
  // Group order: customers alphabetical (case-insensitive), with
  // Internal projects pushed to the end as a single bucket. Within
  // a group, projects keep their orderedProjects order (server sort
  // + parent-then-child).
  interface CustomerGroup {
    /** Stable key — customer name for external, "__internal__" for
     *  internal projects. Drives React's reconciliation key on the
     *  group header row. */
    key: string;
    label: string;
    /** Customer id (null on the Internal and No-customer buckets) —
     *  drives the CustomerChip's deterministic color slot. */
    customerId: string | null;
    customerLogoUrl: string | null;
    isInternal: boolean;
    rows: ProjectRow[];
  }
  const customerGroups = useMemo<CustomerGroup[]>(() => {
    const byKey = new Map<string, CustomerGroup>();
    for (const p of orderedProjects) {
      const isInternal = p.is_internal === true;
      const key = isInternal
        ? "__internal__"
        : `c:${p.customers?.name ?? "__no_customer__"}`;
      const label = isInternal
        ? t("groupInternal")
        : (p.customers?.name ?? t("groupNoCustomer"));
      const customerId = isInternal ? null : (p.customers?.id ?? null);
      const customerLogoUrl = isInternal ? null : (p.customers?.logo_url ?? null);
      const existing = byKey.get(key);
      if (existing) {
        existing.rows.push(p);
      } else {
        byKey.set(key, { key, label, customerId, customerLogoUrl, isInternal, rows: [p] });
      }
    }
    const groups = Array.from(byKey.values());
    groups.sort((a, b) => {
      if (a.isInternal && !b.isInternal) return 1;
      if (!a.isInternal && b.isInternal) return -1;
      return a.label.localeCompare(b.label, undefined, {
        sensitivity: "base",
      });
    });
    return groups;
  }, [orderedProjects, t]);

  // Total visible-data column count — used as the colSpan on each
  // group header row so it spans the entire table width. Updated
  // whenever conditional columns toggle.
  const totalColSpan =
    1 /* checkbox */ +
    1 /* name */ +
    (showTeamColumn ? 1 : 0) +
    1 /* hourly rate */ +
    (showBurnColumn ? 1 : 0) +
    1; /* status */

  useEffect(() => {
    if (selectedCount === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Guard on text-EDITING controls only (list-pages.md rule 5) —
      // a focused checkbox is an <input> too, and Escape from it
      // should still clear the selection.
      if (isTextEditingTarget(e.target)) return;
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCount]);

  // Stable snapshot of the current selection — the arm key for the
  // close-out confirm above, so disarm-on-selection-change falls out
  // of render derivation instead of an effect.
  const selectionKey = useMemo(
    () => Array.from(selected).sort().join(","),
    [selected],
  );
  const closeArmed = closeArmedKey !== null && closeArmedKey === selectionKey;

  // Move focus onto the just-armed Confirm button so the keyboard
  // path (Tab → Close → Enter → Enter) stays continuous after the
  // trigger is replaced by the confirm pair.
  useEffect(() => {
    if (closeArmed) closeConfirmRef.current?.focus();
  }, [closeArmed]);

  // ONE polite live region per list (list-pages.md a11y invariants):
  // announces the result count after a filter commit, and "N selected"
  // (debounced) while a selection is active. The debounce lives in
  // state (updated only inside the timeout callback — never
  // synchronously in the effect body); the message itself is derived
  // at render.
  const [debouncedSelectedCount, setDebouncedSelectedCount] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSelectedCount(selectedCount);
    }, 300);
    return () => clearTimeout(id);
  }, [selectedCount]);
  const liveMessage =
    debouncedSelectedCount > 0
      ? t("liveSelected", { count: debouncedSelectedCount })
      : t("liveResultCount", { count: totalCount });

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === projects.length && projects.length > 0
        ? new Set()
        : new Set(projects.map((p) => p.id)),
    );
  }, [projects]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onBulkSwitchSet = useCallback(
    (categorySetId: string | null): void => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      startTransition(async () => {
        const fd = new FormData();
        for (const id of ids) fd.append("id", id);
        fd.set("category_set_id", categorySetId ?? "");
        try {
          await bulkSwitchCategorySetAction(fd);
          setSelected(new Set());
          setSetPickerOpen(false);
          const setName =
            categorySetId === null
              ? t("bulkSwitchSetNoneLabel")
              : categorySets.find((s) => s.id === categorySetId)?.name ??
                t("bulkSwitchSetUnknown");
          toast.push({
            kind: "success",
            message: t("bulkSwitchSetToast", {
              count: ids.length,
              name: setName,
            }),
          });
        } catch (err) {
          toast.push({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : t("bulkSwitchSetFailed"),
          });
        }
      });
    },
    [selected, startTransition, toast, t, categorySets],
  );

  const onBulkArchive = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await bulkArchiveProjectsAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkArchivedToast", { count: ids.length }),
          actionLabel: tc("actions.undo"),
          onAction: async () => {
            const undoFd = new FormData();
            for (const id of ids) undoFd.append("id", id);
            await bulkRestoreProjectsAction(undoFd);
            toast.push({
              kind: "success",
              message: t("bulkRestoredToast", { count: ids.length }),
            });
          },
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("archiveFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t, tc]);

  const onBulkClose = useCallback((): void => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      try {
        await bulkCloseProjectsAction(fd);
        setSelected(new Set());
        toast.push({
          kind: "success",
          message: t("bulkClosedToast", { count: ids.length }),
          actionLabel: tc("actions.undo"),
          onAction: async () => {
            const undoFd = new FormData();
            for (const id of ids) undoFd.append("id", id);
            await bulkReopenProjectsAction(undoFd);
            toast.push({
              kind: "success",
              message: t("bulkReopenedToast", { count: ids.length }),
            });
          },
        });
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("closeFailed"),
        });
      }
    });
  }, [selected, startTransition, toast, t, tc]);

  const masterRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = someSelected;
    },
    [someSelected],
  );
  const stripMasterRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = someSelected;
    },
    [someSelected],
  );

  // Parent-name lookup for the sub-project sr-only context on the
  // indented name cell ("Sub-project of {parent}"). Built from the
  // visible page — when the parent is filtered/paginated out the
  // child already renders as a top-level row without the label.
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  if (projects.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-edge bg-surface-raised p-8 text-center">
        <p role="status" aria-live="polite" className="sr-only">
          {t("liveResultCount", { count: totalCount })}
        </p>
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <FolderKanban size={20} className="text-accent" aria-hidden="true" />
        </div>
        <h3 className="text-body-lg font-medium text-content">
          {t("emptyTitle")}
        </h3>
        <p className="mt-1 text-caption text-content-muted max-w-md mx-auto">
          {t("emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className={`mt-6 ${tableWrapperClass}`}>
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
      <div
        role="toolbar"
        aria-label={t("bulkToolbarAriaLabel")}
        className="flex items-center gap-3 px-4 py-2 bg-surface-inset border-b border-edge"
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={stripMasterRef}
          onChange={toggleAll}
          className={checkboxClass}
          aria-label={
            allSelected
              ? t("bulkDeselectAllAria")
              : t("bulkSelectAllAria")
          }
        />
        {selectedCount > 0 ? (
          <>
            <span className="text-caption text-content-secondary">
              {t("bulkSelectedLabel", {
                count: selectedCount,
                total: projects.length,
              })}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-caption text-content-secondary hover:text-content hover:underline"
            >
              {t("bulkClear")}
            </button>
            <div
              ref={setPickerRef}
              className="ml-auto relative inline-flex items-center gap-2"
            >
              {categorySets.length > 0 && (
                <>
                  <button
                    ref={setPickerTriggerRef}
                    type="button"
                    onClick={() => setSetPickerOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={setPickerOpen}
                    className={bulkStripButtonClass}
                  >
                    <FolderTree size={14} aria-hidden="true" />
                    {t("bulkSwitchSet", { count: selectedCount })}
                  </button>
                  {setPickerOpen && (
                    <div
                      role="listbox"
                      aria-label={t("bulkSwitchSetListboxAria")}
                      className="absolute right-0 top-full mt-1 w-[280px] max-h-[320px] overflow-auto rounded-lg border border-edge bg-surface-raised shadow-lg p-1 z-20"
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => onBulkSwitchSet(null)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
                      >
                        <span className="font-medium text-content">
                          {t("bulkSwitchSetClear")}
                        </span>
                      </button>
                      <div className="my-1 border-t border-edge-muted" />
                      {categorySets.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => onBulkSwitchSet(s.id)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
                        >
                          <span className="font-medium text-content truncate">
                            {s.is_system
                              ? t("bulkSwitchSetSystemLabel", {
                                  name: s.name,
                                })
                              : s.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {closeArmed ? (
                // Tier-1 inline confirm — closing out is a reversible
                // one-way flip (list-pages.md rule 5), so the action
                // takes an explicit second click, not a typed confirm.
                <>
                  <button
                    ref={closeConfirmRef}
                    type="button"
                    onClick={() => {
                      setCloseArmedKey(null);
                      onBulkClose();
                    }}
                    className={bulkStripButtonClass}
                  >
                    <CircleCheck size={14} aria-hidden="true" />
                    {t("bulkCloseConfirm", { count: selectedCount })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCloseArmedKey(null)}
                    className={bulkStripButtonClass}
                  >
                    {tc("actions.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setCloseArmedKey(selectionKey)}
                  className={bulkStripButtonClass}
                >
                  <CircleCheck size={14} aria-hidden="true" />
                  {t("bulkClose", { count: selectedCount })}
                </button>
              )}
              <button
                type="button"
                onClick={onBulkArchive}
                className={bulkStripDangerButtonClass}
              >
                <Archive size={14} aria-hidden="true" />
                {t("bulkArchive", { count: selectedCount })}
              </button>
            </div>
          </>
        ) : (
          <span className="text-caption text-content-muted">
            {t("bulkSelectHint")}
          </span>
        )}
      </div>

      <table className={tableClass}>
        <colgroup>
          <col style={{ width: "40px" }} />
          <col />
          {showTeamColumn && <col style={{ width: "160px" }} />}
          <col style={{ width: "120px" }} />
          {showBurnColumn && <col style={{ width: "110px" }} />}
          <col style={{ width: "120px" }} />
        </colgroup>
        <thead>
          <tr className={tableHeaderRowClass}>
            <th
              scope="col"
              className={`${tableHeaderCellClass} text-left`}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={masterRef}
                onChange={toggleAll}
                className={checkboxClass}
                aria-label={
                  allSelected
                    ? t("bulkDeselectAllAria")
                    : t("bulkSelectAllAria")
                }
              />
            </th>
            <SortableTableHeader
              label={tc("table.name")}
              sortKey="name"
              currentSort={sort}
              currentDir={dir}
              href={buildSortHref}
            />
            {showTeamColumn && (
              <th
                scope="col"
                className={`${tableHeaderCellClass} text-left`}
              >
                {tc("nav.teams")}
              </th>
            )}
            <SortableTableHeader
              label={t("table.hourlyRate")}
              sortKey="hourly_rate"
              currentSort={sort}
              currentDir={dir}
              href={buildSortHref}
              align="right"
            />
            {showBurnColumn && (
              <th
                scope="col"
                className={`${tableHeaderCellClass} text-right`}
              >
                {t("fields.burnPctColumn")}
              </th>
            )}
            <SortableTableHeader
              label={t("table.status")}
              sortKey="status"
              currentSort={sort}
              currentDir={dir}
              href={buildSortHref}
            />
          </tr>
        </thead>
        <tbody>
          {customerGroups.map((group) => (
            <CustomerGroupRows
              key={group.key}
              group={group}
              colSpan={totalColSpan}
              showTeamColumn={showTeamColumn}
              showBurnColumn={showBurnColumn}
              teamNameById={teamNameById}
              periodBurnPctById={periodBurnPctById}
              noBudgetMinById={noBudgetMinById}
              selected={selected}
              toggleOne={toggleOne}
              projectNameById={projectNameById}
              t={t}
              tc={tc}
            />
          ))}
        </tbody>
      </table>
      <PaginationFooter loaded={projects.length} total={totalCount} />
    </div>
  );
}

/**
 * One customer group: header row + every project row underneath.
 *
 * Header row is a full-width `<th scope="rowgroup" colSpan>` so
 * screen readers announce "row group: Acme Corp" before the data
 * rows. Visually it's a span-the-table band with a folder
 * icon + customer name + project count — three channels (icon /
 * text / typography weight) so the grouping doesn't rely on
 * background color alone.
 *
 * Data rows reuse the existing project-row markup. Sub-projects
 * pick up a `border-l-2 border-edge-muted` on the name cell to
 * make the parent → child relationship readable as a tree line
 * — pairs with the existing ↳ glyph + indent.
 */
function CustomerGroupRows({
  group,
  colSpan,
  showTeamColumn,
  showBurnColumn,
  teamNameById,
  periodBurnPctById,
  noBudgetMinById,
  selected,
  toggleOne,
  projectNameById,
  t,
  tc,
}: {
  group: {
    key: string;
    label: string;
    customerId: string | null;
    customerLogoUrl: string | null;
    isInternal: boolean;
    rows: ProjectRow[];
  };
  colSpan: number;
  showTeamColumn: boolean;
  showBurnColumn: boolean;
  teamNameById: Map<string, string>;
  periodBurnPctById: Record<string, number | null>;
  noBudgetMinById: Record<string, number>;
  selected: Set<string>;
  toggleOne: (id: string) => void;
  /** id → name for every visible project — resolves the sub-project
   *  rows' sr-only "Sub-project of {parent}" context. */
  projectNameById: Map<string, string>;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  return (
    <>
      <tr
        // Visually a span-the-table band; semantically a group
        // label so AT users land on it before the contained data
        // rows. Sticky so the customer context stays visible as
        // the user scrolls a long list — top:0 sticks it to the
        // closest scroll container (the page's main area when the
        // table runs past the viewport).
        className="border-b border-edge bg-surface-inset sticky top-0 z-10"
      >
        {/* <th scope="rowgroup"> per list-pages.md sanctioned
            exceptions — the group header labels the rows beneath it,
            so it must be a header cell, not a <td>. font-normal +
            text-left neutralize the browser's default th styling;
            the visual treatment lives on the inner span. */}
        <th
          scope="rowgroup"
          colSpan={colSpan}
          className="px-4 py-2 bg-surface-inset text-left font-normal"
        >
          <div className="flex items-center gap-2">
            {/* Customer identity per the Entity Identity rule —
                square initials chip from the AVATAR_PRESETS palette,
                hashed on customer.id (or Building glyph for the
                Internal bucket). Replaces the folder/building icon
                that previously stood in for both. */}
            <CustomerChip
              customerId={group.customerId}
              customerName={group.customerId ? group.label : null}
              logoUrl={group.customerLogoUrl}
              internal={group.isInternal}
              size={24}
            />
            <span className="text-label uppercase tracking-wider font-semibold text-content">
              {group.label}
            </span>
            <span className="text-caption text-content-muted">
              {t("groupCount", { count: group.rows.length })}
            </span>
          </div>
        </th>
      </tr>
      {group.rows.map((project) => {
        const isInternal = project.is_internal === true;
        const isSelected = selected.has(project.id);
        const isChild = project.parent_project_id !== null;
        const parentName = project.parent_project_id
          ? projectNameById.get(project.parent_project_id) ?? null
          : null;
        return (
          <tr
            key={project.id}
            className={
              isSelected
                ? `${tableBodyRowClass} bg-accent-soft/30`
                : tableBodyRowClass
            }
          >
            <td className={tableBodyCellClass}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleOne(project.id)}
                className={checkboxClass}
                aria-label={t("bulkRowAria", { name: project.name })}
              />
            </td>
            <td
              className={`${tableBodyCellClass} ${
                isChild ? "border-l-2 border-edge-muted" : ""
              }`}
            >
              {/* sr-only hierarchy context — the visual indent + ↳
                  glyph are aria-hidden, so screen readers get the
                  parent relationship in words instead. Outside the
                  Link so the link's accessible name stays the
                  project's own name. */}
              {isChild && parentName && (
                <span className="sr-only">
                  {t("subProjectOf", { parent: parentName })}
                </span>
              )}
              <Link
                href={`/projects/${project.id}`}
                className={`text-accent hover:underline font-medium ${
                  isChild ? "pl-6 inline-flex items-center gap-1.5" : ""
                }`}
              >
                {/* Visual indent + ↳ glyph for sub-project rows.
                    The sr-only "Sub-project of {parent}" span above
                    carries the hierarchy to AT users (aria-level is
                    inert on plain-table rows); the border-l-2 on the
                    cell renders as a tree line so the relationship
                    reads at a glance, not just via the glyph. */}
                {isChild && (
                  <span
                    aria-hidden="true"
                    className="text-content-muted"
                  >
                    ↳
                  </span>
                )}
                {project.name}
              </Link>
              {isInternal && (
                <Tooltip
                  label={t("classification.internalDescription")}
                >
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary">
                    <Building2 size={10} />
                    {t("internal")}
                  </span>
                </Tooltip>
              )}
            </td>
            {showTeamColumn && (
              <td className={tableBodyCellClass}>
                <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary">
                  {teamNameById.get(project.team_id) ?? "—"}
                </span>
              </td>
            )}
            <td className={`${tableBodyCellClass} text-right font-mono`}>
              {project.hourly_rate
                ? `${formatCurrency(Number(project.hourly_rate))}/hr`
                : "—"}
            </td>
            {showBurnColumn && (
              <td className={`${tableBodyCellClass} text-right`}>
                <div className="flex justify-end">
                  <BurnCell
                    pct={periodBurnPctById[project.id] ?? null}
                    noBudgetMin={noBudgetMinById[project.id] ?? null}
                    projectName={project.name}
                  />
                </div>
              </td>
            )}
            <td className={tableBodyCellClass}>
              <div className="inline-flex items-center gap-1.5">
                <StatusBadge
                  status={project.status ?? "active"}
                  label={tc(`status.${project.status ?? "active"}`)}
                />
                {isProjectOverdue(
                  project.projected_end_date,
                  project.status,
                ) && (
                  <OverdueBadge
                    label={t("overdue")}
                    tooltip={t("overdueTooltip", {
                      date: project.projected_end_date ?? "",
                    })}
                  />
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function BurnCell({
  pct,
  noBudgetMin,
  projectName,
}: {
  pct: number | null;
  /** Trailing-90-day total in minutes for the no-budget case. Null
   *  when the server didn't compute one (back-compat for the test
   *  that mounts without the prop). Zero when the project simply
   *  has no recent activity — rendered as an em-dash + tooltip so
   *  the cell isn't visually loud about nothing. */
  noBudgetMin?: number | null;
  projectName: string;
}): React.JSX.Element {
  const tBurn = useTranslations("projects.table");
  // No budget configured → fall back to trailing-90-day hours
  // (persona-converged 2026-05-12). Hours-only: no rate-drift trap,
  // no currency-mixing, works for internal projects without a rate.
  if (pct === null) {
    if (noBudgetMin == null) {
      return <span className="text-content-muted">—</span>;
    }
    const hours = Math.round(noBudgetMin / 60);
    if (hours === 0) {
      return (
        <Tooltip label={tBurn("burnNoRecent", { project: projectName })}>
          <span className="text-content-muted">—</span>
        </Tooltip>
      );
    }
    return (
      <Tooltip
        label={tBurn("burnRecentHours", { project: projectName, hours })}
      >
        <span className="font-mono tabular-nums text-caption text-content-secondary">
          {hours}h · 90d
        </span>
      </Tooltip>
    );
  }
  // 3-channel encoding: position (bar fill), color, and an icon at
  // the 80%/100% breakpoints. Two non-color channels survives
  // deuteranopia / protanopia — the masthead's hue-only treatment
  // would flatten to a single grayscale fill for those viewers.
  //
  // pctForBar caps display at 100 so the bar fills cleanly even when
  // the project is 250% over budget; the numeric text honors the
  // true value so the reader still sees how bad it is.
  const fillPct = Math.min(100, Math.max(0, pct));
  const fillColorClass =
    pct >= 100
      ? "bg-error"
      : pct >= 80
        ? "bg-warning"
        : "bg-success";
  const textColorClass =
    pct >= 100
      ? "text-error font-semibold"
      : pct >= 80
        ? "text-warning font-semibold"
        : "text-content-secondary";
  const Icon = pct >= 100 ? XCircle : pct >= 80 ? AlertTriangle : null;
  const rounded = Math.round(pct);
  // Fixed-width slots so the column reads cleanly across rows that
  // mix "5%" / "20%" / "100%" / over-budget icons:
  //   [bar 64px] [icon 16px (reserved even when empty)] [% 4ch]
  // tabular-nums on the % text keeps digit columns flush; the 4ch
  // min-width accommodates "100%" without nudging the bar's right
  // edge between rows. The icon slot reserves space even when the
  // project is under 80% so the bar doesn't shift when one row
  // crosses a threshold.
  return (
    <div
      className="inline-flex items-center gap-2 shrink-0"
      role="progressbar"
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={tBurn("burnAria", { project: projectName, pct: rounded })}
    >
      <div className="h-1.5 w-16 rounded-full bg-edge overflow-hidden shrink-0">
        <div
          className={`h-1.5 rounded-full ${fillColorClass}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <span
        aria-hidden="true"
        className="inline-flex w-3 shrink-0 items-center justify-center"
      >
        {Icon && <Icon size={12} className={textColorClass} />}
      </span>
      <span
        className={`font-mono tabular-nums text-caption text-right shrink-0 min-w-[3.5ch] ${textColorClass}`}
      >
        {rounded}%
      </span>
    </div>
  );
}

