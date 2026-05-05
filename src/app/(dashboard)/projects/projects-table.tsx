"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Archive, Building2 } from "lucide-react";
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
} from "./actions";

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
  hourly_rate: number | null;
  status: string | null;
  is_internal: boolean;
  customers: { name: string } | null;
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
}: Props): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
  const selectedCount = selected.size;
  const allSelected = projects.length > 0 && selectedCount === projects.length;
  const someSelected = selectedCount > 0 && !allSelected;

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
      <p className="mt-6 text-body text-content-muted">{t("noProjects")}</p>
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
            <button
              type="button"
              onClick={onBulkArchive}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-error/40 bg-error-soft px-3 py-1.5 text-caption font-semibold text-error-text hover:bg-error/10"
            >
              <Archive size={14} />
              {t("bulkArchive", { count: selectedCount })}
            </button>
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
          <col />
          <col style={{ width: "120px" }} />
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
            <th
              scope="col"
              className={`${tableHeaderCellClass} text-left`}
            >
              {t("table.customer")}
            </th>
            <SortableTableHeader
              label={t("table.hourlyRate")}
              sortKey="hourly_rate"
              currentSort={sort}
              currentDir={dir}
              href={buildSortHref}
            />
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
          {projects.map((project) => {
            const customerName =
              project.customers?.name ?? null;
            const isInternal = project.is_internal === true;
            const isSelected = selected.has(project.id);
            return (
              <tr
                key={project.id}
                className={
                  isSelected
                    ? `${tableBodyRowClass} bg-accent-soft/30`
                    : tableBodyRowClass
                }
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(project.id)}
                    aria-label={t("bulkRowAria", { name: project.name })}
                  />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-accent hover:underline font-medium"
                  >
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
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary">
                      {teamNameById.get(project.team_id) ?? "—"}
                    </span>
                  </td>
                )}
                <td className={tableBodyCellClass}>
                  {isInternal ? (
                    <span className="text-content-muted italic">
                      {t("table.noCustomerInternal")}
                    </span>
                  ) : (
                    (customerName ?? "—")
                  )}
                </td>
                <td className={`${tableBodyCellClass} font-mono`}>
                  {project.hourly_rate
                    ? `$${Number(project.hourly_rate).toFixed(2)}/hr`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge
                    status={project.status ?? "active"}
                    label={tc(`status.${project.status ?? "active"}`)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PaginationFooter loaded={projects.length} total={totalCount} />
    </div>
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
