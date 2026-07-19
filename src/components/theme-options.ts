import type { ComponentType } from "react";
import { Monitor, Sun, Moon, Contrast, BookOpen, Leaf } from "lucide-react";
import type { Theme } from "@/components/theme-provider";

/**
 * THE single source of truth for the in-app theme pickers. Both selectors
 * (the sidebar ThemePickerPopover and the profile page's appearance
 * section) render from this list — they drifted once (the malcom theme
 * shipped to one picker and not the other, 2026-07-18) and must not again.
 *
 * i18n keys live under settings.theme.* in en+es.
 */
export interface ThemeOption {
  key: Theme;
  icon: ComponentType<{ size?: number; className?: string }>;
  i18nKey: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { key: "system", icon: Monitor, i18nKey: "system" },
  { key: "light", icon: Sun, i18nKey: "light" },
  { key: "dark", icon: Moon, i18nKey: "dark" },
  { key: "high-contrast", icon: Contrast, i18nKey: "highContrast" },
  // Selector key stays "warm" so stored prefs survive — only the user-
  // facing label and icon change. Cream paper palette, low glare.
  { key: "warm", icon: BookOpen, i18nKey: "reading" },
  // Brand theme — the Malcom IO palette (malcom.io green) from
  // design-tokens 0.7.0.
  { key: "malcom", icon: Leaf, i18nKey: "malcom" },
];
