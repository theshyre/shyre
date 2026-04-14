"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Group, ChevronDown } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { ALL_GROUPINGS, type GroupingKind } from "@/lib/time/grouping";

interface Props {
  grouping: GroupingKind;
}

export function GroupByPicker({ grouping }: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("time.groupBy");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const choose = useCallback(
    (kind: GroupingKind) => {
      const next = new URLSearchParams(searchParams.toString());
      if (kind === "day") {
        next.delete("groupBy");
      } else {
        next.set("groupBy", kind);
      }
      router.push(`${pathname}?${next.toString()}`);
      setOpen(false);
    },
    [router, pathname, searchParams],
  );

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonSecondaryClass}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Group size={14} />
        <span className="text-xs text-content-muted">{t("label")}:</span>
        {t(`kind.${grouping}`)}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
        >
          {ALL_GROUPINGS.map((k) => {
            const active = k === grouping;
            return (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(k)}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                  active
                    ? "bg-accent-soft text-accent-text"
                    : "text-content-secondary hover:bg-hover"
                }`}
              >
                {t(`kind.${k}`)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
