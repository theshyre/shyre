"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  Check,
  ChevronDown,
  Clock,
  FolderKanban,
  Search,
  X,
} from "lucide-react";
import { inputClass } from "@/lib/form-styles";

export interface ProjectPickerOption {
  id: string;
  name: string;
  /** When non-null, this project is a sub-project of `parent_project_id`. */
  parent_project_id: string | null;
  /** Customer name (or null for internal projects). Surfaces as a
   *  small caption next to the row. */
  customer_name: string | null;
  is_internal: boolean;
}

interface Props {
  /** Full project list — includes parents AND leaves. The picker
   *  groups by customer header, indents sub-projects under their
   *  parent, and treats internal projects as their own section. */
  projects: ProjectPickerOption[];
  /** Recent project ids in newest-first order. Surfaced at the top
   *  of the dropdown as a "Recent" section so the most-likely
   *  picks are one click away. Empty array hides the section. */
  recentIds?: string[];
  /** Selected project id, or "" when nothing is picked. */
  value: string;
  /** Fires whenever the user picks a project. */
  onChange: (id: string) => void;
  /** Optional `name` for native form submission. When provided the
   *  picker renders a hidden <input> carrying the selected id —
   *  drop-in for `<select name="...">`. */
  name?: string;
  /** When true, the trigger renders an empty-required style. */
  required?: boolean;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Searchable, grouped project picker for the New timer / Add past
 * entry forms. Replaces the native `<select>` that previously
 * showed a flat option list with no recent affordance and dropped
 * parent projects entirely.
 *
 * Sections, in order:
 *   1. Recent — up to 5 projects the user touched most recently.
 *   2. Customer groups — alphabetical by customer name. Sub-projects
 *      render indented under their parent so the engagement →
 *      phase relationship reads at a glance.
 *   3. Internal — projects with `is_internal=true`, no customer.
 *
 * Type-to-filter scopes against project name + customer name so
 * the same component scales solo (5 projects → flat list) and
 * agency (80 projects → search earns its keep).
 */
export function ProjectPicker({
  projects,
  recentIds = [],
  value,
  onChange,
  name,
  required,
  id: explicitId,
  ariaLabel,
  placeholder,
  autoFocus,
  className,
}: Props): React.JSX.Element {
  const t = useTranslations("common.projectPicker");
  const generatedId = useId();
  const id = explicitId ?? generatedId;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const projectsById = useMemo(() => {
    const m = new Map<string, ProjectPickerOption>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const selected = value ? projectsById.get(value) ?? null : null;

  // Close on outside click. Hooked unconditionally so the React
  // hook order stays stable across the open / closed renders.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus the search input when the dropdown opens — autofocusing
  // the trigger jumps the user straight into typing.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  // Recent section — at most 5 ids resolved to options. Skip
  // recents that no longer exist in the visible project list.
  const recent = useMemo(() => {
    const out: ProjectPickerOption[] = [];
    const seen = new Set<string>();
    for (const rid of recentIds) {
      if (seen.has(rid)) continue;
      const p = projectsById.get(rid);
      if (!p) continue;
      seen.add(rid);
      out.push(p);
      if (out.length >= 5) break;
    }
    return out;
  }, [recentIds, projectsById]);

  // Apply search filter (name + customer_name, case-insensitive).
  // Empty query passes everything.
  const q = query.trim().toLowerCase();

  // Build customer groups — non-internal projects bucketed by
  // customer_name. Internal projects go to their own section.
  // Sub-projects render under their parent (so the indent is the
  // path indicator); when a search filters out the parent but
  // matches the child, the child still appears in its own group
  // entry (the indent persists for visual consistency).
  interface Group {
    key: string;
    label: string;
    isInternal: boolean;
    rows: Array<{ project: ProjectPickerOption; isChild: boolean }>;
  }
  const groups = useMemo<Group[]>(() => {
    // Inlined predicate so the memo's deps are just (projects, q, t).
    const matches = (p: ProjectPickerOption): boolean => {
      if (q.length === 0) return true;
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.customer_name && p.customer_name.toLowerCase().includes(q))
        return true;
      return false;
    };

    const byKey = new Map<string, Group>();
    const childrenByParent = new Map<string, ProjectPickerOption[]>();
    for (const p of projects) {
      if (p.parent_project_id) {
        const arr = childrenByParent.get(p.parent_project_id) ?? [];
        arr.push(p);
        childrenByParent.set(p.parent_project_id, arr);
      }
    }
    for (const p of projects) {
      const isInternal = p.is_internal === true;
      const isChild = p.parent_project_id !== null;
      // Children are emitted INSIDE their parent's iteration below
      // so they keep contiguity with their parent. Skip them on
      // the top-level pass.
      if (isChild) continue;
      if (!matches(p) && !(childrenByParent.get(p.id) ?? []).some(matches)) {
        continue;
      }
      const key = isInternal
        ? "__internal__"
        : `c:${p.customer_name ?? "__no_customer__"}`;
      const label = isInternal
        ? t("groupInternal")
        : (p.customer_name ?? t("groupNoCustomer"));
      let group = byKey.get(key);
      if (!group) {
        group = { key, label, isInternal, rows: [] };
        byKey.set(key, group);
      }
      // Parent itself
      if (matches(p)) {
        group.rows.push({ project: p, isChild: false });
      }
      // Children
      for (const c of childrenByParent.get(p.id) ?? []) {
        if (matches(c)) {
          group.rows.push({ project: c, isChild: true });
        }
      }
    }
    // Sort: internal last, others alphabetical (case-insensitive).
    const list = Array.from(byKey.values());
    list.sort((a, b) => {
      if (a.isInternal && !b.isInternal) return 1;
      if (!a.isInternal && b.isInternal) return -1;
      return a.label.localeCompare(b.label, undefined, {
        sensitivity: "base",
      });
    });
    return list;
  }, [projects, q, t]);

  function pick(option: ProjectPickerOption): void {
    onChange(option.id);
    setOpen(false);
    setQuery("");
  }

  function clearSelection(e: React.MouseEvent): void {
    e.stopPropagation();
    onChange("");
  }

  const hasResults = (recent.length > 0 && q.length === 0) || groups.length > 0;

  // Trigger label: selected project's name (+ customer if not
  // internal), or placeholder.
  const triggerLabel = (() => {
    if (selected) {
      return selected.name;
    }
    return placeholder ?? t("placeholder");
  })();

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={`${inputClass} flex items-center gap-2 text-left ${
          selected ? "" : "text-content-muted"
        }`}
      >
        <FolderKanban
          size={14}
          className="text-content-muted shrink-0"
          aria-hidden="true"
        />
        <span className="flex-1 truncate">{triggerLabel}</span>
        {selected && selected.customer_name && (
          <span className="text-caption text-content-muted truncate max-w-[160px]">
            {selected.customer_name}
          </span>
        )}
        {selected && !required && (
          <button
            type="button"
            onClick={clearSelection}
            aria-label={t("clear")}
            className="rounded p-0.5 text-content-muted hover:bg-hover"
          >
            <X size={12} />
          </button>
        )}
        <ChevronDown
          size={12}
          className="text-content-muted shrink-0"
          aria-hidden="true"
        />
      </button>

      {/* Hidden input for native form submission — lets this
          component drop into existing forms that use FormData. */}
      {name && <input type="hidden" name={name} value={value} />}

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel ?? t("listboxLabel")}
          className="absolute left-0 top-full mt-1 w-[360px] max-h-[420px] overflow-auto rounded-lg border border-edge bg-surface-raised shadow-lg z-30"
        >
          <div className="sticky top-0 bg-surface-raised border-b border-edge-muted p-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full rounded-md border border-edge bg-surface pl-7 pr-2 py-1 text-caption text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-focus-ring"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
              />
            </div>
          </div>

          {!hasResults && (
            <p className="px-3 py-4 text-caption text-content-muted text-center">
              {t("noResults", { query: q })}
            </p>
          )}

          {recent.length > 0 && q.length === 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-label uppercase tracking-wider text-content-muted flex items-center gap-1.5">
                <Clock size={10} aria-hidden="true" />
                {t("recentHeader")}
              </div>
              {recent.map((p) => (
                <PickerRow
                  key={`recent:${p.id}`}
                  project={p}
                  isChild={false}
                  selected={value === p.id}
                  onPick={() => pick(p)}
                />
              ))}
              <div className="my-1 border-t border-edge-muted" />
            </div>
          )}

          {groups.map((group) => (
            <div key={group.key}>
              <div className="px-3 pt-2 pb-1 text-label uppercase tracking-wider text-content-muted flex items-center gap-1.5">
                {group.isInternal ? (
                  <Building2 size={10} aria-hidden="true" />
                ) : (
                  <FolderKanban size={10} aria-hidden="true" />
                )}
                {group.label}
              </div>
              {group.rows.map(({ project, isChild }) => (
                <PickerRow
                  key={project.id}
                  project={project}
                  isChild={isChild}
                  selected={value === project.id}
                  onPick={() => pick(project)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PickerRow({
  project,
  isChild,
  selected,
  onPick,
}: {
  project: ProjectPickerOption;
  isChild: boolean;
  selected: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover ${
        isChild ? "pl-8" : ""
      } ${selected ? "bg-accent-soft" : ""}`}
    >
      <span className="w-3 shrink-0">
        {selected && <Check size={12} aria-hidden="true" />}
      </span>
      {isChild && (
        <span aria-hidden="true" className="text-content-muted shrink-0">
          ↳
        </span>
      )}
      <span className="flex-1 min-w-0 truncate text-content">
        {project.name}
      </span>
    </button>
  );
}
