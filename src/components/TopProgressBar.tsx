"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Slim accent-colored progress bar pinned to the top of the viewport.
 * Fires when an in-app navigation starts; snaps to 100% + fades on completion.
 *
 * Detection:
 *   - Click on any in-app `<a>` triggers the start (after a small delay so
 *     instant navigations don't flash).
 *   - `usePathname` change signals completion.
 *
 * The animation is nprogress-flavored: grows quickly to ~30%, then trickles
 * toward ~80% asymptotically while loading. If the route resolves before the
 * trickle is done, the bar snaps to 100% and fades. If it never resolves
 * within MAX_LOADING_MS, the bar gives up and hides — protecting against
 * stuck states.
 */

const SHOW_DELAY_MS = 80;       // Don't flash for instant navigations
const HIDE_DELAY_MS = 220;      // Time the "complete" fade is visible
const MAX_LOADING_MS = 12_000;  // Safety: hide after this even if no nav happens

type State = "idle" | "loading" | "complete";

export function TopProgressBar(): React.JSX.Element | null {
  const pathname = usePathname();
  const [state, setState] = useState<State>("idle");
  const prevPathname = useRef(pathname);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      showTimer.current = setTimeout(() => {
        setState("loading");
        // Safety fallback — if pathname never changes, we're not stuck.
        safetyTimer.current = setTimeout(() => setState("idle"), MAX_LOADING_MS);
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

    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }

    setState("complete");
    hideTimer.current = setTimeout(() => setState("idle"), HIDE_DELAY_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
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
  }

  if (state === "idle") return null;

  // Two CSS transitions:
  //   loading: width 0 → 80% over ~3.5s, opacity 1
  //   complete: width 80% → 100% over 120ms, then opacity 1 → 0 over HIDE_DELAY_MS
  const isLoading = state === "loading";
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
      aria-hidden="true"
      role="progressbar"
    >
      <div
        className="h-full bg-accent shadow-[0_0_8px_var(--color-accent,currentColor)]"
        style={{
          width: isLoading ? "80%" : "100%",
          opacity: isLoading ? 1 : 0,
          transition: isLoading
            ? "width 3500ms cubic-bezier(0.1, 0.7, 0.1, 1), opacity 120ms ease-out"
            : `width 120ms ease-out, opacity ${HIDE_DELAY_MS}ms ease-in`,
        }}
      />
    </div>
  );
}
