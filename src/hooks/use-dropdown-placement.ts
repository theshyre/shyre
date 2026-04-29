"use client";

import { useEffect, useState, type RefObject } from "react";

export type DropdownPlacement = "top" | "bottom";

interface Args {
  /** Ref to the trigger element. The hook reads its
   *  getBoundingClientRect() to decide whether the menu should
   *  open above or below. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Whether the menu is currently open. The hook only computes
   *  placement while open — closed menus don't need a placement
   *  at all and re-running the rect-read while closed is wasted
   *  work. */
  open: boolean;
  /** Estimated menu height in px. Doesn't have to be exact —
   *  it's the threshold for "is there enough room below the
   *  trigger to render this comfortably?". Default 320px (a
   *  reasonable mid-size dropdown). */
  estimatedMenuHeight?: number;
}

/**
 * Decide whether a dropdown should open above or below its
 * trigger based on viewport space available. Returns "bottom"
 * when there's enough room below; "top" when the menu would
 * clip the viewport otherwise.
 *
 * Recomputes on the open transition + on viewport resize. Does
 * NOT re-read on scroll — for absolute-positioned dropdowns the
 * scroll context is the same as the document, and our fixed
 * overlays mostly handle their own positioning. If a future
 * caller needs scroll-tracking, add an opt-in flag.
 */
export function useDropdownPlacement({
  triggerRef,
  open,
  estimatedMenuHeight = 320,
}: Args): DropdownPlacement {
  const [placement, setPlacement] = useState<DropdownPlacement>("bottom");

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const compute = (): void => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) {
        setPlacement("top");
      } else {
        setPlacement("bottom");
      }
    };
    compute();
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("resize", compute);
    };
  }, [open, triggerRef, estimatedMenuHeight]);

  return placement;
}
