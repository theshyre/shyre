"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Slim accent-colored progress bar pinned to the top of the viewport.
 *
 * Strategy: react to actual route changes, not click predictions.
 *
 *   1. Document-level click handler on in-app `<a>` flips the bar to
 *      "loading" the moment a navigation is intended.
 *   2. `usePathname` / `useSearchParams` change → flip to "complete"
 *      (with a minimum-visible window so even prefetched/instant routes
 *      get a perceptible flash).
 *   3. Pathname change WITHOUT a preceding click (programmatic nav,
 *      router.push) also triggers a brief flash.
 *
 * The previous version delayed `setState("loading")` until 40ms after
 * the click — but Next 16's prefetched links resolve faster than that,
 * so the show-timer was cancelled before it fired and the bar never
 * appeared. No more show-delay. A "min visible" window absorbs the
 * "instant" case so the user always sees the bar.
 */

const MIN_VISIBLE_MS = 320;
const COMPLETE_FADE_MS = 280;
const SAFETY_MS = 12_000;

type Phase = "hidden" | "loading" | "complete";

export function TopProgressBar(): React.JSX.Element | null {
  const pathname = usePathname();

  const [phase, setPhase] = useState<Phase>("hidden");
  const prevPathname = useRef(pathname);
  const shownAt = useRef<number | null>(null);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show on click, immediately. No predictive delay — that's what was
  // hiding the bar on instant prefetched routes.
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

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      startLoading();
    }

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to route change → "complete", honoring MIN_VISIBLE_MS.
  // Also covers programmatic navigation: if the bar wasn't already
  // loading when the route changed, show it now and complete after
  // the min-visible window.
  useEffect(() => {
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;

    if (shownAt.current === null) {
      // Programmatic nav — start now.
      startLoading();
    }

    const elapsed = shownAt.current ? performance.now() - shownAt.current : 0;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

    if (completeTimer.current) clearTimeout(completeTimer.current);
    completeTimer.current = setTimeout(goComplete, remaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function startLoading(): void {
    clearTimers();
    shownAt.current = performance.now();
    setPhase("loading");
    safetyTimer.current = setTimeout(reset, SAFETY_MS);
  }

  function goComplete(): void {
    setPhase("complete");
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(reset, COMPLETE_FADE_MS);
  }

  function reset(): void {
    setPhase("hidden");
    shownAt.current = null;
    clearTimers();
  }

  function clearTimers(): void {
    if (completeTimer.current) {
      clearTimeout(completeTimer.current);
      completeTimer.current = null;
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

  if (phase === "hidden") return null;

  const isLoading = phase === "loading";

  // Inline styles — bypass any chance Tailwind didn't pick up the
  // accent token. Variable `--accent` is defined for every theme in
  // globals.css, so this renders consistently in light, dark, and
  // high-contrast.
  return (
    <div
      aria-hidden="true"
      role="progressbar"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: isLoading ? "78%" : "100%",
          opacity: isLoading ? 1 : 0,
          background: "var(--accent, #3b82f6)",
          boxShadow:
            "0 0 12px var(--accent, #3b82f6), 0 0 4px var(--accent, #3b82f6)",
          transition: isLoading
            ? "width 3500ms cubic-bezier(0.1, 0.7, 0.1, 1), opacity 120ms ease-out"
            : `width 160ms ease-out, opacity ${COMPLETE_FADE_MS}ms ease-in`,
        }}
      />
    </div>
  );
}
