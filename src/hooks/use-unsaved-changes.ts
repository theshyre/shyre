"use client";

import { useEffect } from "react";

/**
 * Browser-native unsaved-changes guard.
 *
 * When `dirty` is true, attaches a `beforeunload` listener so the
 * browser shows its standard "Leave page?" confirm on tab close,
 * navigation, or refresh. Detaches automatically when `dirty` flips
 * back to false (e.g. after a successful save) and on unmount.
 *
 * Caveat: `beforeunload` only fires on real page unload — not on
 * in-app `router.push` between routes. Next.js doesn't provide a
 * built-in route-change confirm in App Router (the
 * `router.events.on('routeChangeStart')` API was Pages-only). For
 * route-internal navigation guards, use the App Router's `window.
 * addEventListener('popstate', …)` or block the destination via
 * the form submission, not this hook.
 *
 * Per the unsaved-changes guard rule in CLAUDE.md ("UX rules →
 * Unsaved changes guard"). Required on: client edit, project edit,
 * settings, invoice editor, manual time-entry form — and now the
 * Send Invoice composer, where the user invests real effort writing
 * a personalized note that a misclick must not destroy.
 */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      // Setting `returnValue` is the cross-browser opt-in for the
      // native "Leave page?" prompt. Modern browsers ignore the
      // string and show their own message — we just need to set
      // it to a truthy value to trigger the prompt.
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);
}
