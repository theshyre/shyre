"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useTranslations } from "next-intl";
import {
  Palette,
  Monitor,
  Sun,
  Moon,
  Contrast,
  BookOpen,
  Check,
} from "lucide-react";
import { useTheme } from "./theme-provider";
import { Tooltip } from "./Tooltip";

type Theme = "system" | "light" | "dark" | "high-contrast" | "warm";

interface Option {
  key: Theme;
  icon: ComponentType<{ size?: number; className?: string }>;
  i18nKey: string;
}

const OPTIONS: Option[] = [
  { key: "system", icon: Monitor, i18nKey: "system" },
  { key: "light", icon: Sun, i18nKey: "light" },
  { key: "dark", icon: Moon, i18nKey: "dark" },
  { key: "high-contrast", icon: Contrast, i18nKey: "highContrast" },
  // Selector key stays "warm" so stored prefs survive — only the user-
  // facing label and icon change. Cream paper palette, low glare.
  { key: "warm", icon: BookOpen, i18nKey: "reading" },
];

/**
 * Theme picker rendered as an icon button that opens a popover. Used in the
 * sidebar footer. Closes on Escape and outside click. Visual encoding:
 * icon + label in every row; active row shows a Check.
 */
export function ThemePickerPopover(): React.JSX.Element {
  const t = useTranslations("settings.theme");
  const tCommon = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    function onClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        close();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  const currentLabel = t(
    OPTIONS.find((o) => o.key === theme)?.i18nKey ?? "system",
  );

  return (
    <div ref={rootRef} className="relative">
      <Tooltip label={t("title")}>
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          aria-label={`${t("title")}: ${currentLabel}`}
          aria-expanded={open}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-edge text-content-secondary hover:bg-hover transition-colors"
        >
          <Palette size={14} />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          aria-label={t("title")}
          className="absolute bottom-full left-0 z-40 mb-1 w-[176px] rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = theme === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setTheme(opt.key);
                  close();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-body text-left transition-colors ${
                  isActive
                    ? "bg-accent-soft text-accent-text"
                    : "text-content-secondary hover:bg-hover"
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1">{t(opt.i18nKey)}</span>
                {isActive && (
                  <Check size={12} aria-label={tCommon("actions.saved")} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
