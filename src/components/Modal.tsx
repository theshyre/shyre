"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useEscapeDismiss } from "@theshyre/ui";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Max width class. Default: `"max-w-[448px]"`.
   *  Same convention as `@theshyre/ui` — px not rem so the modal
   *  stays a constant width under the user's text-size preference. */
  maxWidth?: string;
  /** Element id of the modal's heading. Wired to `aria-labelledby`
   *  on the dialog so screen readers announce a name when the modal
   *  opens. Required when the modal has a heading; if there's no
   *  heading, prefer `aria-label` instead. */
  titleId?: string;
  /** Plain-text accessible name. Use only when there's no visible
   *  heading inside the modal. */
  ariaLabel?: string;
}

/**
 * Centered modal with focus trap, return-focus, and accessible name.
 *
 * The `@theshyre/ui` Modal handles Escape, backdrop-click, scroll
 * lock, and initial focus, but per the a11y audit it has no focus
 * trap (Tab eventually leaves the modal), no return-focus on close
 * (focus lands on `<body>`), and no accessible name (screen readers
 * announce "dialog" with no label). This wrapper stays as close to
 * the upstream API as possible while fixing those three gaps.
 *
 * Implementation note: we don't reuse `@theshyre/ui`'s Modal as the
 * inner element because we need to manage focus across the entire
 * dialog. The structural markup is duplicated; that's the right
 * trade-off until the fixes land upstream.
 */
export function Modal({
  open,
  onClose,
  children,
  maxWidth = "max-w-[448px]",
  titleId,
  ariaLabel,
}: ModalProps): React.JSX.Element | null {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEscapeDismiss(open, onClose);

  // Body-scroll lock. Same shape as the upstream Modal — re-implemented
  // here because we don't render the upstream dialog.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Capture the triggering element on open so we can restore focus
  // to it on close. Done in an effect (not in the click handler of
  // the trigger) so we work for any caller, including programmatic
  // opens (e.g. opening the keyboard-help modal via `?`).
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current =
        (document.activeElement as HTMLElement | null) ?? null;
    } else if (previouslyFocusedRef.current) {
      // Restore focus on close. `?.focus()` is a no-op if the
      // element was removed from the DOM in the meantime.
      previouslyFocusedRef.current.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [open]);

  // Initial focus inside the modal — first focusable child. If the
  // caller passed `titleId`, prefer focusing the heading first so
  // screen readers announce the modal name immediately.
  useEffect(() => {
    if (!open || !contentRef.current) return;
    const root = contentRef.current;
    const heading = titleId ? root.querySelector<HTMLElement>(`#${CSS.escape(titleId)}`) : null;
    if (heading && heading.tabIndex >= 0) {
      heading.focus();
      return;
    }
    const focusable = firstFocusable(root);
    focusable?.focus();
  }, [open, titleId]);

  // Focus trap. Listen for Tab/Shift+Tab and wrap from last → first
  // (and first → last). Without this, a Tab off the last focusable
  // element inside the dialog moves to the page underneath, even
  // though the dialog still visually covers it.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== "Tab" || !contentRef.current) return;
      const focusables = allFocusable(contentRef.current);
      if (focusables.length === 0) {
        // Nothing focusable inside — keep focus on the dialog
        // container itself (which has tabIndex=-1) so Tab is a
        // no-op rather than escaping.
        e.preventDefault();
        contentRef.current.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !contentRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-surface-overlay"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : ariaLabel}
        // tabIndex=-1 makes the dialog itself programmatically
        // focusable as a fallback when nothing inside is focusable.
        tabIndex={-1}
        className={`relative w-full ${maxWidth} rounded-xl border border-edge bg-surface-raised p-6 shadow-2xl focus:outline-none`}
      >
        {children}
      </div>
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

function allFocusable(root: HTMLElement): HTMLElement[] {
  // No `offsetParent` filter — that heuristic is unreliable in
  // jsdom (every element has null offsetParent because nothing is
  // laid out) and easy to get wrong with display:contents wrappers.
  // `aria-hidden` is the explicit signal callers can set.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute("aria-hidden"));
}
