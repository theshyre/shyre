"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Tag, FolderKanban, Loader2, Check } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useDropdownPlacement } from "@/hooks/use-dropdown-placement";
import { EXPENSE_CATEGORIES } from "./categories";
import { getCategoryHelp } from "./categories-help";
import type { ProjectOption } from "./page";

/**
 * Bulk-action dropdown pickers for the expenses table toolbar.
 *
 * Shape: dense, single-line items in a `role="menu"` with full
 * keyboard navigation (Arrow Up / Down / Home / End / Enter /
 * Escape). The category picker's rich help (description +
 * examples) lives behind a per-item Tooltip — visible on hover,
 * never crowding the default rendering — so the menu stays
 * compact and consistent with the per-row inline edit.
 *
 * Viewport-aware: a `useDropdownPlacement` hook flips the menu
 * up when there isn't enough room below the trigger.
 *
 * Pending state: while the action is in flight, the trigger
 * shows a spinner and disables (so a second click during a slow
 * server roundtrip doesn't re-fire).
 */

interface CategoryProps {
  onSelect: (category: string) => Promise<void>;
}

export function BulkCategoryPicker({
  onSelect,
}: CategoryProps): React.JSX.Element {
  const t = useTranslations("expenses");
  return (
    <DropdownPicker
      label={t("bulk.setCategory")}
      icon={<Tag size={14} />}
      menuWidthPx={320}
      items={EXPENSE_CATEGORIES.map((c) => ({
        key: c,
        value: c,
        label: t(`categories.${c}`),
        help: getCategoryHelp(c, t),
      }))}
      onSelect={onSelect}
    />
  );
}

interface ProjectProps {
  projects: ProjectOption[];
  onSelect: (projectId: string) => Promise<void>;
}

export function BulkProjectPicker({
  projects,
  onSelect,
}: ProjectProps): React.JSX.Element {
  const t = useTranslations("expenses");
  const items: DropdownItem[] = [
    {
      key: "__none",
      value: "",
      label: t("noProject"),
      muted: true,
      help: null,
    },
    ...projects.map((p) => ({
      key: p.id,
      value: p.id,
      label: p.name,
      muted: false,
      help: null,
    })),
  ];
  return (
    <DropdownPicker
      label={t("bulk.setProject")}
      icon={<FolderKanban size={14} />}
      menuWidthPx={240}
      disabledTooltip={
        projects.length === 0 ? t("bulk.noProjectsToAssign") : null
      }
      disabled={projects.length === 0}
      items={items}
      onSelect={onSelect}
    />
  );
}

// ────────────────────────────────────────────────────────────────
// Shared dropdown primitive
// ────────────────────────────────────────────────────────────────

interface DropdownItem {
  /** Unique React key. */
  key: string;
  /** Value passed to onSelect. */
  value: string;
  /** Visible label. */
  label: string;
  /** Optional rich help — description + examples — shown in the
   *  menu's sticky footer when this item is the active one. We
   *  render help in ONE persistent footer instead of per-item
   *  tooltips because:
   *    - tooltips flicker as the cursor moves through items
   *    - tooltip auto-positioning gets clipped near viewport edges
   *    - keyboard nav doesn't naturally trigger tooltips, so kbd
   *      users were missing the help entirely
   *  Footer pattern updates instantly on hover or arrow-nav, no
   *  positioning logic, never clipped. */
  help?: { description: string; examples: string } | null;
  /** When true, the item renders muted/italic — used for the
   *  "No project" clear-link option in the project picker. */
  muted?: boolean;
}

interface DropdownPickerProps {
  label: string;
  icon: React.ReactNode;
  items: DropdownItem[];
  onSelect: (value: string) => Promise<void>;
  menuWidthPx: number;
  disabled?: boolean;
  disabledTooltip?: string | null;
}

function DropdownPicker({
  label,
  icon,
  items,
  onSelect,
  menuWidthPx,
  disabled = false,
  disabledTooltip = null,
}: DropdownPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Value of the item currently being committed via onSelect, or
  // null when nothing is in flight. The menu stays OPEN during
  // the commit + briefly shows a ✓ "done" state on success
  // before closing — gives the user undeniable in-place feedback
  // ("yes, I clicked Software and the system applied it") that
  // a tiny trigger spinner + bottom-of-viewport toast wasn't
  // delivering.
  const [committingValue, setCommittingValue] = useState<string | null>(null);
  const [doneValue, setDoneValue] = useState<string | null>(null);
  const pending = committingValue !== null || doneValue !== null;
  // Index of the currently focused (keyboard-highlighted) item.
  // -1 when nothing is highlighted yet.
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Estimate: items capped at the scroll-region max (280px) plus
  // the help-footer when any item has help (~64px) plus a small
  // border allowance. The placement hook uses this to decide
  // whether to flip the menu above the trigger.
  const hasHelpFooter = items.some((it) => it.help);
  const placement = useDropdownPlacement({
    triggerRef,
    open,
    estimatedMenuHeight: Math.min(
      items.length * 36 + (hasHelpFooter ? 64 : 0) + 8,
      360,
    ),
  });

  // On open: focus the first item; on close: return focus to
  // the trigger so keyboard users don't lose context.
  useEffect(() => {
    if (open) {
      setActiveIdx(0);
      // Defer to next tick so the menu has rendered + items are
      // in the ref array.
      const id = window.setTimeout(() => {
        itemRefs.current[0]?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Sync focus to the active item whenever the index changes.
  useEffect(() => {
    if (!open) return;
    if (activeIdx < 0 || activeIdx >= items.length) return;
    itemRefs.current[activeIdx]?.focus();
  }, [activeIdx, open, items.length]);

  // Click-outside dismiss + Escape dismiss + focus restore.
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onClick(e: MouseEvent): void {
      const t = e.target as Node | null;
      if (
        triggerRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const handleMenuKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i <= 0 ? items.length - 1 : i - 1));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveIdx(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveIdx(items.length - 1);
        return;
      }
    },
    [open, items.length],
  );

  async function commit(value: string): Promise<void> {
    if (committingValue !== null || doneValue !== null) return; // already in flight
    setCommittingValue(value);
    let succeeded = false;
    try {
      await onSelect(value);
      succeeded = true;
    } catch {
      // Parent's onSelect handles its own toast / error rendering.
      // Just clear the pending state so the menu re-enables.
    } finally {
      setCommittingValue(null);
    }
    if (succeeded) {
      // Brief ✓ state before closing — gives the eye a moment to
      // register that the action completed in-place before the
      // menu disappears.
      setDoneValue(value);
      window.setTimeout(() => {
        setDoneValue(null);
        setOpen(false);
        triggerRef.current?.focus();
      }, 600);
    }
  }

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => !disabled && !pending && setOpen((v) => !v)}
      disabled={disabled || pending}
      aria-haspopup="menu"
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1 text-caption font-medium text-content hover:bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" aria-label="Saving" />
      ) : (
        icon
      )}
      {label}
    </button>
  );

  return (
    <div className="relative">
      {disabled && disabledTooltip ? (
        // labelMode="describe" preserves the button's visible text
        // ("Set project") as its accessible name; the tooltip is
        // supplemental ("No active projects to assign") via
        // aria-describedby. Without this, screen readers would
        // announce the disabled trigger by its tooltip text only.
        <Tooltip label={disabledTooltip} labelMode="describe" showOnDisabled>
          {triggerButton}
        </Tooltip>
      ) : (
        triggerButton
      )}
      {open && (
        <div
          ref={menuRef}
          tabIndex={-1}
          onKeyDown={handleMenuKey}
          className={`absolute right-0 z-20 flex flex-col rounded-md border border-edge bg-surface shadow-lg ${
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ width: menuWidthPx }}
        >
          {/* Items list — scrolls if it overflows the max height,
              keeping the help footer below it pinned. */}
          <div role="menu" className="max-h-[280px] overflow-y-auto">
            {items.map((item, i) => {
              const isActive = activeIdx === i;
              const isCommitting = committingValue === item.value;
              const isDone = doneValue === item.value;
              const isOtherPending =
                pending && !isCommitting && !isDone;
              const showActiveStyle = isActive || isCommitting || isDone;
              return (
                <button
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  key={item.key}
                  type="button"
                  role="menuitem"
                  tabIndex={isActive ? 0 : -1}
                  onMouseEnter={() =>
                    !isOtherPending && setActiveIdx(i)
                  }
                  onClick={() => !pending && void commit(item.value)}
                  disabled={isOtherPending || isCommitting || isDone}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body transition-colors ${
                    // Strong "this is what you'll commit / what
                    // you just committed" state: accent-soft bg +
                    // accent-coloured text + 2px left-edge stripe.
                    // Same look for hover, in-flight, and just-done
                    // so the user's eye stays anchored to the row
                    // they clicked through the whole interaction.
                    showActiveStyle
                      ? "bg-accent-soft text-accent border-l-2 border-accent pl-[10px]"
                      : "border-l-2 border-transparent text-content"
                  } ${
                    item.muted ? "italic text-content-muted border-b border-edge-muted" : ""
                  } ${
                    isOtherPending ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <span className="flex-1">{item.label}</span>
                  {/* Lucide Loader2 instead of @theshyre/ui's
                      Spinner: vector-rotation is unmistakable
                      and doesn't depend on border-color cascade
                      (the Spinner's transparent-edge trick can
                      collide with bg-accent-soft). */}
                  {isCommitting && (
                    <Loader2
                      size={14}
                      className="animate-spin text-accent shrink-0"
                      aria-label="Saving"
                    />
                  )}
                  {isDone && (
                    <Check
                      size={14}
                      className="text-success shrink-0"
                      aria-label="Saved"
                    />
                  )}
                </button>
              );
            })}
          </div>
          {/* Sticky help footer — shows the active item's
              description + examples. Only rendered when at least
              one item in this menu has help (e.g. categories);
              project menus have no help, so the footer is hidden
              entirely and the menu collapses to just its items. */}
          {items.some((it) => it.help) && (
            <div className="border-t border-edge-muted bg-surface-inset px-3 py-2 space-y-0.5">
              {activeIdx >= 0 && items[activeIdx]?.help ? (
                <>
                  <p className="text-caption text-content-secondary">
                    {items[activeIdx]!.help!.description}
                  </p>
                  <p className="text-caption text-content-muted italic">
                    {items[activeIdx]!.help!.examples}
                  </p>
                </>
              ) : (
                <p className="text-caption text-content-muted italic">
                  {/* Idle / empty state — keeps the footer height
                      stable so the menu doesn't bounce when the
                      user moves out of an item briefly. */}
                  &nbsp;
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
