"use client";

import { useEffect } from "react";

/**
 * Prepend a "• " marker to `document.title` while a form is dirty.
 *
 * Mirrors the convention in Notion / Linear / VS Code: the bullet
 * tells the user at a tab-strip glance that this page has unsaved
 * changes. The marker is restored on cleanup so navigating away
 * (or the form going clean) leaves the title untouched.
 *
 * Implementation note: we observe `document.title` via a
 * MutationObserver so the marker survives when Next.js updates the
 * title on route change while the dirty flag is still true. Without
 * this, the bullet would silently fall off whenever metadata for a
 * sub-route resolved.
 */
export function useDirtyTitle(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const titleNode: Node = titleEl;

    const observer = new MutationObserver(() => {
      if (!document.title.startsWith("• ")) {
        // Pause the observer while we mutate to avoid feedback loops.
        observer.disconnect();
        document.title = `• ${document.title}`;
        observer.observe(titleNode, { childList: true });
      }
    });

    if (!document.title.startsWith("• ")) {
      document.title = `• ${document.title}`;
    }
    observer.observe(titleNode, { childList: true });

    return () => {
      observer.disconnect();
      if (document.title.startsWith("• ")) {
        document.title = document.title.slice(2);
      }
    };
  }, [dirty]);
}
