import Link from "next/link";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { tableHeaderCellClass } from "@/lib/table-styles";

interface Props {
  label: string;
  /** Stable key written to the URL (e.g. "name", "hourly_rate"). */
  sortKey: string;
  /** Currently active sort key from the URL, or null when unset. */
  currentSort: string | null;
  /** Currently active direction. */
  currentDir: "asc" | "desc";
  /** Builds the next-state URL given the column the user clicks. */
  href: (params: { sort: string; dir: "asc" | "desc" }) => string;
  align?: "left" | "right";
}

/**
 * Server-rendered sortable column header. Click cycles asc → desc on
 * the same column, or jumps to asc when switching columns. Pure Link
 * navigation — no client JS, no state. Pages compute the next URL
 * via the `href` callback so each list page owns its own param shape
 * (e.g. `?org=…` filters survive across sort clicks).
 *
 * Accessibility: `aria-sort` reflects the active state on the th so
 * screen readers announce sort order. The chevron icon is decorative.
 */
export function SortableTableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  href,
  align = "left",
}: Props): React.JSX.Element {
  const isActive = currentSort === sortKey;
  const nextDir: "asc" | "desc" =
    isActive && currentDir === "asc" ? "desc" : "asc";

  const ariaSort: "ascending" | "descending" | "none" = isActive
    ? currentDir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  const alignClass = align === "right" ? "text-right" : "text-left";
  const justifyClass = align === "right" ? "justify-end" : "justify-start";

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`${tableHeaderCellClass} ${alignClass}`}
    >
      <Link
        href={href({ sort: sortKey, dir: nextDir })}
        className={`group inline-flex items-center gap-1 ${justifyClass} hover:text-content transition-colors`}
        aria-label={
          isActive
            ? `${label}, sorted ${ariaSort}. Click to sort ${
                nextDir === "asc" ? "ascending" : "descending"
              }.`
            : `Sort by ${label}`
        }
      >
        {label}
        {isActive ? (
          currentDir === "asc" ? (
            <ChevronUp size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )
        ) : (
          <ChevronsUpDown
            size={12}
            aria-hidden
            className="opacity-30 group-hover:opacity-60 transition-opacity"
          />
        )}
      </Link>
    </th>
  );
}
