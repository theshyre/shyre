"use client";

/**
 * Shyre's theme provider — a thin binding around the shared factory in
 * `@theshyre/theme`. The factory takes Shyre's localStorage key so the
 * same shared implementation can also serve Liv without the two apps
 * colliding on the same origin.
 */

import { createThemeStore, type Theme } from "@theshyre/theme";

const store = createThemeStore({ storageKey: "stint-theme" });

export const ThemeProvider = store.ThemeProvider;
export const useTheme = store.useTheme;
export type { Theme };
