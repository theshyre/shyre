"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Tag, FolderKanban } from "lucide-react";
import { Spinner } from "@theshyre/ui";
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
      menuWidthPx={220}
      items={EXPENSE_CATEGORIES.map((c) => {
        const help = getCategoryHelp(c, t);
        return {
          key: c,
          value: c,
          label: t(`categories.${c}`),
          tooltip: `${help.description}\n\n${help.examples}`,
        };
      })}
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
  const items = [
    {
      key: "__none",
      value: "",
      label: t("noProject"),
      muted: true,
      tooltip: null,
    },
    ...projects.map((p) => ({
      key: p.id,
      value: p.id,
      label: p.name,
      muted: false,
      tooltip: null,
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
  /** Optional tooltip rendered on hover/focus. Null suppresses. */
  tooltip?: string | null;
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
  const [pending, setPending] = useState(false);
  // Index of the currently focused (keyboard-highlighted) item.
  // -1 when nothing is highlighted yet.
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const placement = useDropdownPlacement({
    triggerRef,
    open,
    estimatedMenuHeight: Math.min(items.length * 36 + 8, 360),
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
    setOpen(false);
    setPending(true);
    try {
      await onSelect(value);
    } finally {
      setPending(false);
      // Return focus to the trigger after the action completes.
      triggerRef.current?.focus();
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
      {pending ? <Spinner size="h-3 w-3" /> : icon}
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
          role="menu"
          tabIndex={-1}
          onKeyDown={handleMenuKey}
          className={`absolute right-0 z-20 max-h-[360px] overflow-y-auto rounded-md border border-edge bg-surface shadow-lg ${
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ width: menuWidthPx }}
        >
          {items.map((item, i) => {
            const button = (
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={activeIdx === i ? 0 : -1}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => void commit(item.value)}
                className={`block w-full text-left px-3 py-2 text-body transition-colors ${
                  activeIdx === i ? "bg-hover" : ""
                } ${item.muted ? "italic text-content-muted border-b border-edge-muted" : "text-content"}`}
              >
                {item.label}
              </button>
            );
            return item.tooltip ? (
              <Tooltip key={item.key} label={item.tooltip} labelMode="describe">
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </div>
      )}
    </div>
  );
}
