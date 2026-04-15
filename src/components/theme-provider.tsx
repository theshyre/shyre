"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

type Theme = "system" | "light" | "dark" | "high-contrast" | "warm";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Apply a theme value from an external source (e.g. DB preference) */
  applyExternalTheme: (theme: Theme) => void;
  themes: readonly Theme[];
}

const STORAGE_KEY = "stint-theme";
const THEMES = ["system", "light", "dark", "high-contrast", "warm"] as const;
const THEME_CHANGE_EVENT = "stint-theme-change";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme): void {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored && THEMES.includes(stored) ? stored : "system";
}

function subscribeToTheme(onChange: () => void): () => void {
  // Fires for in-app setTheme() calls (same tab) and cross-tab storage events.
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeTheme(next: Theme): void {
  localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // localStorage is the source of truth. The anti-flash script in <head>
  // has already applied data-theme before hydration, so we just need React
  // state to read the same value — useSyncExternalStore does exactly that
  // without the setState-in-effect pattern.
  const getServerSnapshot = (): Theme => "system";
  const theme = useSyncExternalStore<Theme>(
    subscribeToTheme,
    readStoredTheme,
    getServerSnapshot,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    writeTheme(next);
  }, []);

  // External-source variant exists so the settings page can push a DB-
  // preferred theme into the same store without going through the user's
  // click handler. Same write path.
  const applyExternalTheme = useCallback((next: Theme) => {
    writeTheme(next);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, applyExternalTheme, themes: THEMES }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
