"use client";

import { useEffect } from "react";

/**
 * Warns the user before navigating away from a page with unsaved changes.
 */
export function useUnsavedChanges(hasChanges: boolean): void {
  useEffect(() => {
    if (!hasChanges) return;

    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);
}
