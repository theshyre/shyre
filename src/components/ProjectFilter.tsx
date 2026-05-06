"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, FolderKanban, FolderTree } from "lucide-react";
import { countSubProjects } from "@/lib/projects/expand-filter";

export interface ProjectFilterOption {
  id: string;
  name: string;
  /** When non-null, this project is a sub-project of `parent_project_id`. */
  parent_project_id: string | null;
  /** Customer name (or null for internal projects). Surfaced as a small
   *  caption so two projects named "Phase 1" under different customers
   *  can be told apart in the picker. */
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
 */
export function ProjectFilter({
  projects,
  selectedId,
}: Props): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("common.projectFilter");

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

  if (projects.length === 0) return null;

  const selected =
    selectedId !== null
      ? projects.find((p) => p.id === selectedId) ?? null
      : null;
  const subCount = selected ? countSubProjects(projects, selected.id) : 0;

  function pick(id: string | null): void {
    const params = new URLSearchParams(searchParams.toString());
    if (id === null) {
      params.delete("project");
    } else {
      params.set("project", id);
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
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

  function buttonLabel(): string {
    if (!selected) return t("all");
    return selected.name;
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
        {selected && subCount > 0 ? (
          <FolderTree size={12} aria-hidden="true" />
        ) : (
          <FolderKanban size={12} aria-hidden="true" />
        )}
        <span className="truncate max-w-[180px]">{buttonLabel()}</span>
        {selected && subCount > 0 && (
          <span className="text-content-muted">
            {t("includesSub", { count: subCount })}
          </span>
        )}
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("listboxLabel")}
          className="absolute z-20 mt-1 w-[280px] max-h-[360px] overflow-auto rounded-lg border border-edge bg-surface-raised shadow-lg p-1"
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

          {topLevel.map((p) => {
            const kids = childrenByParent.get(p.id) ?? [];
            return (
              <div key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.id === p.id}
                  onClick={() => pick(p.id)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
                >
                  <span className="w-3 shrink-0 mt-0.5">
                    {selected?.id === p.id && (
                      <Check size={12} aria-hidden="true" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-content">
                      {p.name}
                      {kids.length > 0 && (
                        <span className="ml-1 text-content-muted">
                          {t("includesSub", { count: kids.length })}
                        </span>
                      )}
                    </span>
                    {p.customer_name && (
                      <span className="block truncate text-content-muted text-[11px]">
                        {p.customer_name}
                      </span>
                    )}
                    {p.is_internal && (
                      <span className="block truncate text-content-muted text-[11px]">
                        {t("internal")}
                      </span>
                    )}
                  </span>
                </button>
                {kids.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={selected?.id === c.id}
                    onClick={() => pick(c.id)}
                    className="flex w-full items-start gap-2 rounded-md pl-7 pr-2 py-1.5 text-left text-caption hover:bg-hover"
                  >
                    <span className="w-3 shrink-0 mt-0.5">
                      {selected?.id === c.id && (
                        <Check size={12} aria-hidden="true" />
                      )}
                    </span>
                    <span className="block truncate text-content-secondary">
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
