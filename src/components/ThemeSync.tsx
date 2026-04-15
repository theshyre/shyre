"use client";

import { useEffect, useRef } from "react";
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
 * One-way sync DB → ThemeProvider. Runs **once per mount**: if the server-
 * read preference differs from the current provider state, push the DB value
 * in. After that, client state is authoritative for the session. Without
 * the ref-guard, a click from the in-app theme picker would trigger a
 * rerender, the effect would see `preferredTheme !== theme` and snap back
 * to the DB value — see the TextSizeSync incident.
 */
export function ThemeSync({ preferredTheme }: Props): null {
  const { theme, applyExternalTheme } = useTheme();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;
    if (preferredTheme && preferredTheme !== theme) {
      applyExternalTheme(preferredTheme);
    }
  }, [preferredTheme, theme, applyExternalTheme]);

  return null;
}
