"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  Palette,
  Check,
} from "lucide-react";
import { useTheme } from "./theme-provider";
import { useToast } from "./Toast";
import { Tooltip } from "./Tooltip";

import { THEME_OPTIONS } from "./theme-options";
import { setAppearancePreferenceAction } from "@/app/(dashboard)/profile/actions";

const OPTIONS = THEME_OPTIONS;

const PANEL_WIDTH = 176;
const PANEL_GAP = 8;

/**
 * Theme picker rendered as an icon button that opens a popover. Used
 * inside the ProfilePopover (which itself is a popover with
 * `overflow-hidden`). Closes on Escape and outside click. Visual
 * encoding: icon + label in every row; active row shows a Check.
 *
 * Why portal-based: the parent ProfilePopover has `overflow-hidden`
 * (so its rounded corners actually clip the menu items inside).
 * That clipping ALSO clipped this popover and made it overlap the
 * parent's avatar/email header in a confusing way. Rendering into
 * `document.body` via createPortal lets the panel float above the
 * page entirely, free of any ancestor's overflow rules. Position is
 * computed from the trigger's getBoundingClientRect so it tracks
 * the trigger across viewport sizes.
 */
export function ThemePickerPopover(): React.JSX.Element {
  const t = useTranslations("settings.theme");
  const toast = useToast();
  const tCommon = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  // Wrap-span ref instead of a direct ref on the button — Tooltip's
  // cloneElement reads `child.ref`, which trips React 19's
  // `element.ref` deprecation when the child has a ref. The span's
  // bounding rect matches the button (`inline-flex` wrapping a
  // single button), so getBoundingClientRect still gives the right
  // anchor for panel positioning. Same pattern as ProfilePopover /
  // jump-to-date.
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Move focus into the panel on open (the active theme's button) so
  // keyboard/SR users land inside the popover instead of the portal
  // dumping them at the end of the document.
  useEffect(() => {
    if (!open) return;
    const active = panelRef.current?.querySelector<HTMLButtonElement>(
      "button[aria-pressed='true']",
    );
    (active ?? panelRef.current?.querySelector("button"))?.focus();
  }, [open]);

  // Compute panel position relative to the trigger at click time so
  // there's no need to setState inside a layout effect (lint rule
  // react-hooks/set-state-in-effect bans that pattern). Same shape
  // as entry-kebab-menu.tsx. Open above when the panel fits there;
  // flip to below when it would clip off the top.
  function computePanelPos(): { top: number; left: number } | null {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = OPTIONS.length * 36 + 8;
    const fitsAbove = rect.top - panelHeight - PANEL_GAP > 8;
    const top = fitsAbove
      ? rect.top - panelHeight - PANEL_GAP
      : rect.bottom + PANEL_GAP;
    // Right-edge align: the trigger sits at the right of the
    // controls row; aligning the panel's right edge to the trigger's
    // right edge keeps the menu visually grouped with the icon
    // without spilling off the right of the viewport.
    const left = Math.max(8, rect.right - PANEL_WIDTH);
    return { top, left };
  }

  // Close on Escape and outside click. Outside-click checks both
  // the trigger and the portaled panel (each in a different DOM
  // tree, so two refs).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    function onClick(e: MouseEvent): void {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) close();
    }
    function onScrollOrResize(): void {
      // Fixed-positioned panel drifts from the trigger as the page
      // scrolls/resizes. Close rather than chase — matches user
      // expectation ("I scrolled, the menu went away").
      close();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  const currentLabel = t(
    OPTIONS.find((o) => o.key === theme)?.i18nKey ?? "system",
  );

  const panel = open && panelPos && (
    <div
      ref={panelRef}
      // Not role="menu": a menu contract promises arrow-key navigation and
      // menuitem semantics this list never implemented — SRs announced a
      // pattern the keyboard couldn't deliver. A labeled group of plain
      // toggle buttons is honest and fully keyboardable via Tab.
      role="group"
      data-popover-panel
      aria-label={t("title")}
      style={{ top: panelPos.top, left: panelPos.left, width: PANEL_WIDTH }}
      className="fixed z-50 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isActive = theme === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              setTheme(opt.key);
              // Persist — the sidebar picker previously wrote localStorage
              // only, so a refresh snapped back to the stale DB value.
              // Surface failures (autosave mandate): a silently-failed save
              // resurfaces as "theme reset on reload", which reads as data
              // loss to the user.
              const fd = new FormData();
              fd.set("preferred_theme", opt.key);
              void setAppearancePreferenceAction(fd).catch(() => {
                toast.push({ kind: "error", message: t("saveFailed") });
              });
              close();
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-body text-left transition-colors ${
              isActive
                ? "bg-accent-soft text-accent-text"
                : "text-content-secondary hover:bg-hover"
            }`}
          >
            <Icon size={14} className="shrink-0" />
            <span className="flex-1">{t(opt.i18nKey)}</span>
            {isActive && (
              <Check size={12} aria-label={tCommon("actions.saved")} />
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Tooltip label={t("title")}>
          <button
            type="button"
            onClick={() => {
              if (!open) {
                const pos = computePanelPos();
                if (pos) setPanelPos(pos);
              } else {
                setPanelPos(null);
              }
              setOpen((p) => !p);
            }}
            aria-label={`${t("title")}: ${currentLabel}`}
            aria-expanded={open}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-edge text-content-secondary hover:bg-hover transition-colors"
          >
            <Palette size={14} />
          </button>
        </Tooltip>
      </span>
      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
