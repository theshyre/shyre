"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  CheckCircle,
  ChevronDown,
  Pause,
  Search,
  Users,
} from "lucide-react";
import { kbdClass } from "@/lib/form-styles";
import { CustomerChip } from "@/components/CustomerChip";

interface CustomerOption {
  id: string;
  name: string;
}

const STATUS_KEYS = [
  "all",
  "active",
  "paused",
  "completed",
  "archived",
] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

/**
 * URL-driven status filter chip. "All" relaxes the default
 * archived-hidden behavior; the named statuses pin to a single
 * value. Default = "active" (matches the page's default).
 */
export function StatusFilter({
  selected,
}: {
  selected: StatusKey;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters.status");
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

  function pick(next: StatusKey): void {
    const params = new URLSearchParams(searchParams.toString());
    // "active" is the default and gets stripped from the URL so a
    // bookmarked /projects link without ?status= still lands on the
    // expected default, and the URL stays clean.
    if (next === "active") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  const isCustomized = selected !== "active";

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
        <CheckCircle size={12} aria-hidden="true" />
        {t(`label.${selected}`)}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t("listboxLabel")}
          className="absolute left-0 top-full mt-1 w-[180px] rounded-lg border border-edge bg-surface-raised shadow-lg p-1 z-20"
        >
          {STATUS_KEYS.map((s) => (
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

export type CustomerFilterSelection =
  | { kind: "all" }
  | { kind: "internal" }
  | { kind: "id"; id: string };

/**
 * URL-driven customer filter — picks a single customer (or
 * "Internal projects only", or "All customers"). Single-select
 * keeps the picker tight; multi-select is a future ask if real
 * users need it.
 */
export function CustomerFilter({
  selection,
  customers,
}: {
  selection: CustomerFilterSelection;
  customers: CustomerOption[];
}): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters.customer");
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

  if (customers.length === 0) return null;

  function pick(next: CustomerFilterSelection): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next.kind === "all") {
      params.delete("customer");
    } else if (next.kind === "internal") {
      params.set("customer", "internal");
    } else {
      params.set("customer", next.id);
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  const label = (() => {
    if (selection.kind === "all") return t("label.all");
    if (selection.kind === "internal") return t("label.internal");
    return (
      customers.find((c) => c.id === selection.id)?.name ??
      t("label.unknown")
    );
  })();

  const isCustomized = selection.kind !== "all";

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
        {selection.kind === "internal" ? (
          <Building2 size={12} aria-hidden="true" />
        ) : (
          <Users size={12} aria-hidden="true" />
        )}
        <span className="truncate max-w-[160px]">{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t("listboxLabel")}
          className="absolute left-0 top-full mt-1 w-[260px] max-h-[360px] overflow-auto rounded-lg border border-edge bg-surface-raised shadow-lg p-1 z-20"
        >
          <button
            type="button"
            role="option"
            aria-selected={selection.kind === "all"}
            onClick={() => pick({ kind: "all" })}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
          >
            <span className="w-3 shrink-0">
              {selection.kind === "all" && (
                <CheckCircle size={12} aria-hidden="true" />
              )}
            </span>
            <Users size={12} className="text-content-muted" aria-hidden="true" />
            <span className="font-medium text-content">
              {t("label.all")}
            </span>
          </button>
          <button
            type="button"
            role="option"
            aria-selected={selection.kind === "internal"}
            onClick={() => pick({ kind: "internal" })}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
          >
            <span className="w-3 shrink-0">
              {selection.kind === "internal" && (
                <CheckCircle size={12} aria-hidden="true" />
              )}
            </span>
            <Building2
              size={12}
              className="text-content-muted"
              aria-hidden="true"
            />
            <span className="font-medium text-content">
              {t("label.internal")}
            </span>
          </button>
          <div className="my-1 border-t border-edge-muted" />
          {customers.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={
                selection.kind === "id" && selection.id === c.id
              }
              onClick={() => pick({ kind: "id", id: c.id })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-hover"
            >
              <span className="w-3 shrink-0">
                {selection.kind === "id" && selection.id === c.id && (
                  <CheckCircle size={12} aria-hidden="true" />
                )}
              </span>
              <CustomerChip
                customerId={c.id}
                customerName={c.name}
                size={14}
              />
              <span className="font-medium text-content truncate">
                {c.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Free-text search box for project names. Submits on Enter so the
 * URL only updates when the user commits — avoids per-keystroke
 * server round-trips. `/` keyboard shortcut focuses the input;
 * Escape blurs and clears the local edit (URL keeps its current q).
 */
export function ProjectSearchInput({
  initialQuery,
}: {
  initialQuery: string;
}): React.JSX.Element {
  // Wrapper component so the URL-driven `initialQuery` can act as a
  // remount key. Lets the inner form pick up external URL changes
  // (e.g. the Clear-filters button) without a setState-in-effect
  // sync hook (which the React-purity lint rule blocks).
  return (
    <ProjectSearchInputBody key={initialQuery} initialQuery={initialQuery} />
  );
}

function ProjectSearchInputBody({
  initialQuery,
}: {
  initialQuery: string;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters.search");
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialQuery);

  // `/` shortcut focuses the search input — same convention as
  // most list pages in Shyre. Skip when another input is already
  // focused or a modifier is held so we don't hijack typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "/") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(
    (next: string): void => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        params.delete("q");
      } else {
        params.set("q", trimmed);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="relative inline-flex items-center"
      role="search"
    >
      <Search
        size={12}
        className="absolute left-3 text-content-muted pointer-events-none"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setValue(initialQuery);
            inputRef.current?.blur();
          }
        }}
        placeholder={t("placeholder")}
        aria-label={t("ariaLabel")}
        className="rounded-full border border-edge bg-surface pl-7 pr-12 py-1 text-caption text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-focus-ring w-[220px]"
      />
      <kbd
        className={`${kbdClass} absolute right-2 pointer-events-none`}
        aria-hidden="true"
      >
        /
      </kbd>
    </form>
  );
}

/**
 * Visual hint surfaced below the toolbar when one or more filters
 * are active AND the result set is empty — gives the user a quick
 * way to clear the offending filters and try again.
 */
export function ProjectFiltersClearHint({
  active,
}: {
  active: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("projects.filters");
  if (!active) return null;
  function clearAll(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("customer");
    params.delete("q");
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <div className="mt-3 inline-flex items-center gap-2 text-caption text-content-muted">
      <span>{t("noResultsHint")}</span>
      <button
        type="button"
        onClick={clearAll}
        className="text-accent hover:underline"
      >
        {t("clearAll")}
      </button>
    </div>
  );
}

/** Compact pause-icon badge — surfaced when the active status filter
 *  is one of the named pinned values, as a redundant visual cue. */
export function StatusBadgeIconForKey(key: StatusKey): React.JSX.Element {
  if (key === "paused") return <Pause size={12} aria-hidden="true" />;
  return <CheckCircle size={12} aria-hidden="true" />;
}
