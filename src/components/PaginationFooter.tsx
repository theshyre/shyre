"use client";

import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";

interface Props {
  /** Total rows matching the current filter (server-side count). */
  total: number;
  /** Rows currently rendered. Pagination is "load more" → each
   *  click bumps `?limit=` so loaded grows monotonically. */
  loaded: number;
  /** Rows to add per "Load N more" click. Default 50 — matches the
   *  initial DEFAULT_LIST_LIMIT in `lib/pagination/list-pagination.ts`. */
  step?: number;
}

/**
 * Load-more footer for paginated list pages. Renders nothing when
 * everything matching the filter is already loaded; otherwise
 * shows two link-buttons:
 *
 *   - "Load N more"  → bumps `?limit` by `step` (capped at total)
 *   - "Load all N"   → bumps `?limit` directly to total (only when
 *                      remaining > step, otherwise "Load N more"
 *                      would do the same job)
 *
 * Both use Next 16 `<Link>` with `scroll={false}` so the user stays
 * at their current scroll position — they're reading row 47 and
 * just want rows 51-100 appended below, not to lose their place.
 *
 * URL-driven so pagination state is bookmarkable and survives a
 * refresh. Selection state lives in the table component (client
 * state) and survives the navigation because Next preserves
 * client-component state across same-route searchParams changes.
 */
export function PaginationFooter({
  total,
  loaded,
  step = 50,
}: Props): React.JSX.Element | null {
  const t = useTranslations("common.pagination");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (loaded >= total) return null;

  const remaining = total - loaded;
  const nextStep = Math.min(step, remaining);

  const buildHref = (newLimit: number): string => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", String(newLimit));
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div
      className="flex items-center justify-center gap-3 py-3 border-t border-edge"
      role="navigation"
      aria-label={t("ariaLabel")}
    >
      <span className="text-caption text-content-muted">
        {t("loadedOf", { loaded, total })}
      </span>
      <Link
        href={buildHref(loaded + nextStep)}
        scroll={false}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1.5 text-caption font-medium text-content hover:bg-hover transition-colors"
      >
        <ChevronDown size={14} />
        {t("loadNMore", { count: nextStep })}
        <LinkPendingSpinner size={10} className="" />
      </Link>
      {remaining > step && (
        <Link
          href={buildHref(total)}
          scroll={false}
          className="inline-flex items-center gap-1 text-caption text-content-secondary hover:text-content underline-offset-2 hover:underline"
        >
          {t("loadAll", { count: remaining })}
          <LinkPendingSpinner size={10} className="" />
        </Link>
      )}
    </div>
  );
}
