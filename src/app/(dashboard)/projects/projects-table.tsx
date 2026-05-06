"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Archive, Building2, FolderKanban, FolderTree } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { SortableTableHeader } from "@/components/SortableTableHeader";
import { PaginationFooter } from "@/components/PaginationFooter";
import {
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
} from "./actions";

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
  hourly_rate: number | null;
  status: string | null;
  is_internal: boolean;
  /** When set, this row is a sub-project. The list renders it
   *  immediately below its parent with an indented label so the
   *  hierarchy is visible at a glance. */
  parent_project_id: string | null;
  customers: { name: string } | null;
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
  /** Per-project current-period burn % — rendered as a column when
   *  any visible project has a recurring period configured. Empty
   *  object renders as "—" for every row. Computed server-side. */
  periodBurnPctById?: Record<string, number | null>;
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
}: Props): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const setPickerRef = useRef<HTMLDivElement>(null);

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
  // Show the Period Burn column only when at least one visible
  // project has a recurring period configured (and therefore a
  // numeric burn). Zero work otherwise — keeps the projects list
  // clean for users who don't use recurring caps.
  const showBurnColumn = Object.values(periodBurnPctById).some(
    (v) => v != null,
  );
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
      const existing = byKey.get(key);
      if (existing) {
        existing.rows.push(p);
      } else {
        byKey.set(key, { key, label, isInternal, rows: [p] });
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
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCount]);

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

  if (projects.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-edge bg-surface-raised p-8 text-center">
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
            <div
              ref={setPickerRef}
              className="ml-auto relative inline-flex items-center gap-2"
            >
              {categorySets.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSetPickerOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={setPickerOpen}
                    className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1.5 text-caption font-medium text-content-secondary hover:bg-hover"
                  >
                    <FolderTree size={14} />
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
              <button
                type="button"
                onClick={onBulkArchive}
                className="inline-flex items-center gap-1.5 rounded-md border border-error/40 bg-error-soft px-3 py-1.5 text-caption font-semibold text-error-text hover:bg-error/10"
              >
                <Archive size={14} />
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
            />
            {showBurnColumn && (
              <th
                scope="col"
                className={`${tableHeaderCellClass} text-right`}
              >
                {t("burnPctColumn")}
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
              selected={selected}
              toggleOne={toggleOne}
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
 * Header row uses `<th scope="rowgroup">` semantics rendered as a
 * `<tr>` so screen readers announce "row group: Acme Corp" before
 * the data rows. Visually it's a span-the-table band with a folder
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
  selected,
  toggleOne,
  t,
  tc,
}: {
  group: {
    key: string;
    label: string;
    isInternal: boolean;
    rows: ProjectRow[];
  };
  colSpan: number;
  showTeamColumn: boolean;
  showBurnColumn: boolean;
  teamNameById: Map<string, string>;
  periodBurnPctById: Record<string, number | null>;
  selected: Set<string>;
  toggleOne: (id: string) => void;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  const HeaderIcon = group.isInternal ? Building2 : FolderKanban;
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
        <td colSpan={colSpan} className="px-4 py-2 bg-surface-inset">
          <div className="flex items-center gap-2">
            <HeaderIcon
              size={14}
              className="text-content-muted shrink-0"
              aria-hidden="true"
            />
            <span className="text-label uppercase tracking-wider font-semibold text-content">
              {group.label}
            </span>
            <span className="text-caption text-content-muted">
              {t("groupCount", { count: group.rows.length })}
            </span>
          </div>
        </td>
      </tr>
      {group.rows.map((project) => {
        const isInternal = project.is_internal === true;
        const isSelected = selected.has(project.id);
        const isChild = project.parent_project_id !== null;
        return (
          <tr
            key={project.id}
            aria-level={isChild ? 2 : 1}
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
                aria-label={t("bulkRowAria", { name: project.name })}
              />
            </td>
            <td
              className={`${tableBodyCellClass} ${
                isChild ? "border-l-2 border-edge-muted" : ""
              }`}
            >
              <Link
                href={`/projects/${project.id}`}
                className={`text-accent hover:underline font-medium ${
                  isChild ? "pl-6 inline-flex items-center gap-1.5" : ""
                }`}
              >
                {/* Visual indent + ↳ glyph for sub-project rows.
                    aria-level on the <tr> communicates the
                    hierarchy to AT users; the border-l-2 on the
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
            <td className={`${tableBodyCellClass} font-mono`}>
              {project.hourly_rate
                ? `$${Number(project.hourly_rate).toFixed(2)}/hr`
                : "—"}
            </td>
            {showBurnColumn && (
              <td className={`${tableBodyCellClass} text-right`}>
                <BurnCell pct={periodBurnPctById[project.id] ?? null} />
              </td>
            )}
            <td className={tableBodyCellClass}>
              <StatusBadge
                status={project.status ?? "active"}
                label={tc(`status.${project.status ?? "active"}`)}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function BurnCell({ pct }: { pct: number | null }): React.JSX.Element {
  if (pct === null) {
    return <span className="text-content-muted">—</span>;
  }
  // Color anchored at fixed 80/100 — same rule as the masthead bars
  // so a yellow row always means "approaching cap" regardless of
  // each project's individual threshold setting.
  const colorClass =
    pct >= 100
      ? "text-error font-semibold"
      : pct >= 80
        ? "text-warning font-semibold"
        : "text-content-secondary";
  return (
    <span className={`font-mono tabular-nums ${colorClass}`}>
      {Math.round(pct)}%
    </span>
  );
}

function StatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}): React.JSX.Element {
  const colorMap: Record<string, string> = {
    active: "bg-success-soft text-success-text",
    paused: "bg-warning-soft text-warning-text",
    completed: "bg-info-soft text-info-text",
    archived: "bg-surface-inset text-content-muted",
  };
  const classes = colorMap[status] ?? "bg-surface-inset text-content-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
