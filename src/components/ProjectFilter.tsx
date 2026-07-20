"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FolderKanban, FolderTree } from "lucide-react";
import { FilterChip, type FilterChipOption } from "@/components/FilterChip";
import { countSubProjects } from "@/lib/projects/expand-filter";

export interface ProjectFilterOption {
  id: string;
  name: string;
  /** When non-null, this project is a sub-project of `parent_project_id`. */
  parent_project_id: string | null;
  /** Customer name (or null for internal projects). Surfaced next to
   *  the project name so two projects named "Phase 1" under different
   *  customers can be told apart in the picker. */
  customer_name: string | null;
  is_internal: boolean;
}

interface Props {
  /** Picker source list — both parent AND leaf projects, unlike the
   *  entry-creation picker which is leaf-only. Sub-projects are
   *  rendered indented underneath their parent. */
  projects: ProjectFilterOption[];
  /** Selected project id, or null when the filter is off ("All
   *  projects"). When the selected id is a parent, the server expands
   *  to that parent + its leaf children — see
   *  `src/lib/projects/expand-filter.ts`. */
  selectedId: string | null;
}

/** Sentinel key for the "All projects" option — project ids are
 *  UUIDs so this can't collide with a real row. */
const ALL_KEY = "__all__";

/**
 * URL-driven project picker for /time-entries (and /reports).
 *
 * Picking a parent rolls up: the server expands to parent + leaf
 * children before applying the `.in()` filter, so a user filtering
 * by "Engagement" sees entries on both the parent project itself
 * AND on every phase underneath it. Picking a leaf scopes to just
 * that leaf.
 *
 * Why single-select rather than multi-select like the invoice form:
 * the rollup-by-parent affordance covers the most common
 * "everything on this engagement" intent without requiring the
 * user to tick boxes. Multi-select adds surface for a second-order
 * use case ("phases 1 and 2 but not 3") that nobody has asked
 * for — see `docs/reference/sub-projects-roadmap.md` Phase C
 * "out of scope" for the rationale.
 *
 * Built on the shared `<FilterChip>` scaffold (list-pages.md rule 1 +
 * a11y invariants) instead of a hand-rolled dropdown — the previous
 * implementation only closed on outside click, so Escape did nothing
 * and focus never returned to the trigger. The parent/child hierarchy
 * (customer name, sub-project count, Internal tag) now folds into
 * each option's single-string label since `<FilterChip>` renders one
 * text node per row — indentation on children still reads as a tree
 * via `labelClassName`.
 */
export function ProjectFilter({
  projects,
  selectedId,
}: Props): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("common.projectFilter");

  if (projects.length === 0) return null;

  const selected =
    selectedId !== null
      ? projects.find((p) => p.id === selectedId) ?? null
      : null;
  const subCount = selected ? countSubProjects(projects, selected.id) : 0;

  function pick(key: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (key === ALL_KEY) {
      params.delete("project");
    } else {
      params.set("project", key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // Render order: each top-level project, then its children indented
  // beneath. Top-level = parent_project_id === null. We deliberately
  // sort top-level by name (already sorted from the server query) and
  // children right after their parent so the visual hierarchy
  // matches the projects list page.
  const topLevel = projects.filter((p) => p.parent_project_id === null);
  const childrenByParent = new Map<string, ProjectFilterOption[]>();
  for (const p of projects) {
    if (p.parent_project_id) {
      const list = childrenByParent.get(p.parent_project_id) ?? [];
      list.push(p);
      childrenByParent.set(p.parent_project_id, list);
    }
  }

  function valueLabel(): string {
    if (!selected) return t("all");
    if (subCount > 0) return `${selected.name} ${t("includesSub", { count: subCount })}`;
    return selected.name;
  }

  const options: FilterChipOption[] = [
    {
      key: ALL_KEY,
      label: t("all"),
      selected: selected === null,
      labelClassName: "font-medium text-content",
      separatorAfter: true,
    },
  ];
  for (const p of topLevel) {
    const kids = childrenByParent.get(p.id) ?? [];
    const parts = [p.name];
    if (kids.length > 0) parts.push(t("includesSub", { count: kids.length }));
    if (p.customer_name) parts.push(p.customer_name);
    if (p.is_internal) parts.push(t("internal"));
    options.push({
      key: p.id,
      label: parts.join(" · "),
      icon:
        kids.length > 0 ? (
          <FolderTree size={12} className="text-content-muted shrink-0" aria-hidden="true" />
        ) : (
          <FolderKanban size={12} className="text-content-muted shrink-0" aria-hidden="true" />
        ),
      selected: selected?.id === p.id,
      labelClassName: "text-content",
    });
    for (const c of kids) {
      options.push({
        key: c.id,
        label: c.customer_name ? `${c.name} · ${c.customer_name}` : c.name,
        selected: selected?.id === c.id,
        labelClassName: "pl-4 text-content-secondary",
      });
    }
  }

  return (
    <FilterChip
      icon={
        selected && subCount > 0 ? (
          <FolderTree size={12} aria-hidden="true" />
        ) : (
          <FolderKanban size={12} aria-hidden="true" />
        )
      }
      dimensionLabel={t("dimension")}
      valueLabel={valueLabel()}
      valueClassName="truncate max-w-[180px]"
      listboxLabel={t("listboxLabel")}
      customized={selected !== null}
      panelClassName="w-[280px] max-h-[360px] overflow-auto"
      options={options}
      onPick={pick}
    />
  );
}
