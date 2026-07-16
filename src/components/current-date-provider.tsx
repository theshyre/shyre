"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getLocalToday, getOffsetForZone } from "@/lib/time/tz";

const CurrentDateContext = createContext<string | null>(null);

/**
 * The viewer's current local date (YYYY-MM-DD), kept live across midnight
 * rollover. Read via this hook from under a {@link CurrentDateProvider}: the
 * three time views (and any other "today"-sensitive surface) consume this
 * single source instead of each computing `new Date()`, so they all move in
 * lockstep at the rollover boundary. Throws when no provider is mounted so a
 * missing wrapper fails loudly rather than silently freezing "today".
 */
export function useCurrentDate(): string {
  const value = useContext(CurrentDateContext);
  if (value === null) {
    throw new Error("useCurrentDate must be used within a CurrentDateProvider");
  }
  return value;
}

/**
 * Compute the viewer's local date right now, mirroring page.tsx's offset
 * resolution so the client value matches the server-rendered one: an explicit
 * IANA timezone wins (DST-correct at this instant); otherwise the browser's
 * live offset. Recomputed on every tick, so a DST transition or the user
 * travelling across zones is picked up without a reload.
 */
function computeLocalToday(timezone: string | null): string {
  const offset = timezone
    ? getOffsetForZone(timezone, new Date())
    : new Date().getTimezoneOffset();
  return getLocalToday(offset);
}

/**
 * True while the user is actively editing a control. A rollover
 * `router.refresh()` re-pulls server props and can reorder / re-key rows,
 * blurring the caret and clobbering an in-progress inline edit (the
 * `feedback_inline_edit_no_revalidate` lesson). We always move the decorative
 * "today" marker immediately, but defer the server refresh until the field is
 * released.
 */
function isEditingFocused(): boolean {
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return true;
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Localized long date for the SR announcement, e.g. "Wednesday, April 15, 2026". */
function formatLongLocalDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  // Noon avoids any DST/offset edge nudging the calendar day.
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface CurrentDateProviderProps {
  /** Server-computed local date (YYYY-MM-DD) — the SSR / hydration seed. */
  initialToday: string;
  /** The viewer's explicit IANA timezone, or null to track the browser. */
  timezone: string | null;
  children: ReactNode;
}

/**
 * Shell-level provider that keeps "today" fresh on a long-loaded dashboard.
 * Mounted once in the dashboard layout alongside {@link TimezoneSync}. When
 * the local day rolls over (or the tab regains focus after a rollover), it
 * moves the reactive marker and — once the user isn't mid-edit — triggers a
 * soft `router.refresh()` so server-derived "today" (default day/week window,
 * overdue flags, "as of today" reports) catches up too.
 */
export function CurrentDateProvider({
  initialToday,
  timezone,
  children,
}: CurrentDateProviderProps): React.JSX.Element {
  const t = useTranslations("common");
  const router = useRouter();
  const [today, setToday] = useState(initialToday);
  const [announcement, setAnnouncement] = useState("");
  // Compared against inside the interval closure, which is set up once and
  // would otherwise capture a stale `today` (the effect deps intentionally
  // exclude it so the interval isn't torn down on every rollover).
  const todayRef = useRef(initialToday);
  // A rollover detected while an input is focused parks the refresh here; it
  // flushes on the next tick / focusout / tab-focus once editing ends.
  const pendingRefresh = useRef(false);

  useEffect(() => {
    function flushRefresh(): void {
      if (pendingRefresh.current && !isEditingFocused()) {
        pendingRefresh.current = false;
        router.refresh();
      }
    }

    function check(): void {
      const next = computeLocalToday(timezone);
      if (todayRef.current !== next) {
        todayRef.current = next;
        setToday(next);
        setAnnouncement(
          t("freshness.dayChanged", { date: formatLongLocalDate(next) }),
        );
        // Soft refresh preserves client state + scroll (unlike
        // revalidatePath), but still re-pulls server props — so hold it
        // while the user is typing and flush on release.
        if (isEditingFocused()) {
          pendingRefresh.current = true;
        } else {
          router.refresh();
        }
      }
      // A prior rollover may have parked a refresh while the user typed —
      // flush it now that we're re-checking.
      flushRefresh();
    }

    // Minute-granularity poll: self-corrects after laptop sleep / background
    // tab throttling, unlike a single long setTimeout to midnight which fires
    // unreliably. The visibility / focus re-check is the instant catch-up
    // when the user returns to a backgrounded tab.
    const intervalId = setInterval(check, 60_000);
    function onVisible(): void {
      if (!document.hidden) check();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("focusout", flushRefresh);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("focusout", flushRefresh);
    };
  }, [timezone, router, t]);

  return (
    <CurrentDateContext.Provider value={today}>
      {children}
      {/* Persistent polite live region — announces the rollover to screen
          readers (WCAG 4.1.3 Status Messages). Mounted empty before any
          update so assistive tech reliably speaks the change. */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </CurrentDateContext.Provider>
  );
}
