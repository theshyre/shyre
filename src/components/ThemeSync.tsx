"use client";

import { useEffect } from "react";
import { useTheme } from "./theme-provider";

interface Props {
  /**
   * The theme the server read from user_settings.preferred_theme. `null` means
   * the user hasn't picked one — follow the client's local preference / system.
   */
  preferredTheme:
    | "system"
    | "light"
    | "dark"
    | "high-contrast"
    | "warm"
    | null;
}

/**
 * One-way sync from DB → ThemeProvider. When the user has an explicit theme
 * saved on the server, apply it on mount so the UI matches across devices.
 * If no DB preference exists, this is a no-op (the ThemeProvider's localStorage
 * logic runs unchanged).
 */
export function ThemeSync({ preferredTheme }: Props): null {
  const { theme, applyExternalTheme } = useTheme();

  useEffect(() => {
    if (preferredTheme && preferredTheme !== theme) {
      applyExternalTheme(preferredTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredTheme]);

  return null;
}
