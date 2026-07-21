"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Briefcase } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";

interface SwitcherBusiness {
  id: string;
  label: string;
}

interface Props {
  current: SwitcherBusiness;
  /** Every business the viewer can access, sorted. Includes `current`. */
  businesses: SwitcherBusiness[];
}

/**
 * Hub-header business identity. With a single business it renders the
 * name as a plain, non-interactive title (context stays visible without
 * a pointless dropdown). With two or more it becomes a switcher: a
 * button that opens a labeled `<nav>` of the viewer's businesses so they
 * can jump between entities in one click without going back to the list.
 *
 * The panel is a `<nav>` of real `<Link>`s (routed navigation), not a
 * `role="menu"` — a menu would promise arrow-key navigation it doesn't
 * implement (WAI-ARIA APG: tabs/links that navigate to new pages use
 * links in a nav). Close-on-Escape + outside-click + focus-restore
 * mirror the ProfilePopover idiom.
 */
export function BusinessSwitcher({
  current,
  businesses,
}: Props): React.JSX.Element {
  const t = useTranslations("business");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        close();
        rootRef.current?.querySelector("button")?.focus();
      }
    }
    function onClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  // Single business: the title is context, not a control.
  if (businesses.length <= 1) {
    return (
      <h1 className="text-page-title font-bold text-content break-words">
        {current.label}
      </h1>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-label={t("switcher.label")}
        className={`flex items-center gap-2 rounded-md -ml-1 px-1 py-0.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
          open ? "bg-hover" : ""
        }`}
      >
        <span className="text-page-title font-bold text-content break-words">
          {current.label}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`shrink-0 text-content-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <nav
          aria-label={t("switcher.label")}
          className="absolute left-0 top-full z-40 mt-1 min-w-[240px] max-w-[360px] rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
        >
          <p className="px-3 pt-2 pb-1 text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("switcher.current")}
          </p>
          <div className="pb-1">
            {businesses.map((biz) => {
              const isCurrent = biz.id === current.id;
              return (
                <Link
                  key={biz.id}
                  href={`/business/${biz.id}`}
                  onClick={close}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`flex items-center gap-2 px-3 py-2 text-body transition-colors ${
                    isCurrent
                      ? "bg-accent-soft text-accent-text"
                      : "text-content-secondary hover:bg-hover hover:text-content"
                  }`}
                >
                  <Briefcase size={14} className="shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{biz.label}</span>
                  {isCurrent && (
                    <Check size={14} className="shrink-0" aria-hidden="true" />
                  )}
                  <LinkPendingSpinner size={12} className="" />
                </Link>
              );
            })}
          </div>
          <div className="border-t border-edge py-1">
            <Link
              href="/business"
              onClick={close}
              className="flex items-center gap-2 px-3 py-2 text-body text-content-secondary hover:bg-hover hover:text-content transition-colors"
            >
              <span className="flex-1">{t("switcher.allBusinesses")}</span>
              <LinkPendingSpinner size={12} className="" />
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
