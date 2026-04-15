"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Slim accent-colored progress bar pinned to the top of the viewport.
 * Fires when an in-app navigation starts; snaps to 100% + fades on completion.
 *
 * Detection:
 *   - Click on any in-app `<a>` triggers the start (after a small delay so
 *     genuinely-zero-cost navigations don't flash).
 *   - `usePathname` change signals completion.
 *
 * Once the bar enters "loading", it stays visible for at least
 * MIN_VISIBLE_MS so even fast navigations get a perceptible signal.
 *
 * The animation is nprogress-flavored: trickles toward ~80% over ~3.5s
 * while loading, then snaps to 100% and fades on pathname change.
 * Safety: if the route never resolves within MAX_LOADING_MS, the bar
 * gives up and hides.
 */

const SHOW_DELAY_MS = 40;       // Don't flash for genuinely-zero-cost navigations
const MIN_VISIBLE_MS = 320;     // Once "loading", stay visible at least this long
const HIDE_DELAY_MS = 260;      // Time the "complete" fade is visible
const MAX_LOADING_MS = 12_000;  // Safety: hide after this even if no nav happens

type State = "idle" | "loading" | "complete";

export function TopProgressBar(): React.JSX.Element | null {
  const pathname = usePathname();
  const [state, setState] = useState<State>("idle");
  const prevPathname = useRef(pathname);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minVisibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number | null>(null);
  // Buffer for "complete" deferred until min-visible elapses.
  const deferredComplete = useRef(false);

  // Show on click (after a brief delay, so instant routes don't flicker).
  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("//")
      ) {
        return;
      }

      // External links — skip
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // Same-page link — no nav
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      // Schedule loading state. If the new pathname appears before SHOW_DELAY,
      // it gets cancelled in the pathname effect.
      clearAll();
      deferredComplete.current = false;
      showTimer.current = setTimeout(() => {
        shownAt.current = performance.now();
        setState("loading");
        // Safety fallback — if pathname never changes, don't lock the UI.
        safetyTimer.current = setTimeout(() => {
          setState("idle");
          shownAt.current = null;
        }, MAX_LOADING_MS);
      }, SHOW_DELAY_MS);
    }

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect navigation completion via pathname change.
  useEffect(() => {
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;

    // If we never got past show-delay, never showed → nothing to complete.
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
      return;
    }
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }

    // Honor MIN_VISIBLE_MS — defer the "complete" transition so users
    // actually perceive the bar even on a snappy server response.
    const elapsed = shownAt.current ? performance.now() - shownAt.current : 0;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

    const goComplete = (): void => {
      setState("complete");
      hideTimer.current = setTimeout(() => {
        setState("idle");
        shownAt.current = null;
      }, HIDE_DELAY_MS);
    };

    if (remaining === 0) {
      goComplete();
    } else {
      deferredComplete.current = true;
      minVisibleTimer.current = setTimeout(() => {
        if (deferredComplete.current) {
          deferredComplete.current = false;
          goComplete();
        }
      }, remaining);
    }
  }, [pathname]);

  function clearAll(): void {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
    if (minVisibleTimer.current) {
      clearTimeout(minVisibleTimer.current);
      minVisibleTimer.current = null;
    }
  }

  if (state === "idle") return null;

  const isLoading = state === "loading";
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-1"
      aria-hidden="true"
      role="progressbar"
    >
      <div
        className="h-full bg-accent"
        style={{
          width: isLoading ? "80%" : "100%",
          opacity: isLoading ? 1 : 0,
          boxShadow:
            "0 0 10px var(--color-accent, currentColor), 0 0 4px var(--color-accent, currentColor)",
          transition: isLoading
            ? "width 3500ms cubic-bezier(0.1, 0.7, 0.1, 1), opacity 120ms ease-out"
            : `width 140ms ease-out, opacity ${HIDE_DELAY_MS}ms ease-in`,
        }}
      />
    </div>
  );
}
