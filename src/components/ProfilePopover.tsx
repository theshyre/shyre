"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  ChevronDown,
  LogOut,
  User,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { TextSizeSwitcher } from "./TextSizeSwitcher";
import { ThemePickerPopover } from "./ThemePickerPopover";
import { Tooltip } from "./Tooltip";

interface Props {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  userId: string;
  isProfileActive: boolean;
  isDocsActive: boolean;
  onSignOut: () => void;
}

/**
 * Sidebar footer: avatar + display name as a single row, click to
 * open a popover with the rare-but-needed actions (text size, theme,
 * profile, docs, sign out). Replaces what used to be five separate
 * stacked rows in the sidebar — saves ~120px of vertical chrome and
 * keeps the load-bearing pieces (timer, team chip) above the fold on
 * smaller laptop viewports.
 *
 * Pattern mirrors ThemePickerPopover (close on Escape + outside click,
 * `role="menu"`, `aria-expanded` on the trigger). Email is reachable
 * via the trigger's tooltip — collapsed inline so the row stays one
 * line tall.
 *
 * Theme picker remains its own popover-in-a-popover so the existing
 * idiom (icon button → list of theme options) is preserved without
 * inlining 5 theme rows here.
 */
export function ProfilePopover({
  displayName,
  email,
  avatarUrl,
  userId,
  isProfileActive,
  isDocsActive,
  onSignOut,
}: Props): React.JSX.Element {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        close();
        // Restore focus to the trigger so keyboard users don't lose
        // their place in the tab order.
        triggerRef.current?.focus();
      }
    }
    function onClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        // Click might be inside a portaled child popover (e.g. the
        // ThemePicker dropdown, which renders into document.body to
        // escape this popover's `overflow-hidden`). Don't close in
        // that case — closing would unmount the child mid-click and
        // the user's selection would never reach its handler.
        const target = e.target as HTMLElement | null;
        if (target?.closest('[role="menu"]')) return;
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      {/* Single-row trigger. Click anywhere on it to open the menu;
          tooltip surfaces the email so the user can still see it
          without taking up a second line of chrome. */}
      <Tooltip label={`${displayName} · ${email}`}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((p) => !p)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("nav.profile")}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover ${
            open ? "bg-hover" : ""
          }`}
        >
          <Avatar
            avatarUrl={avatarUrl}
            displayName={displayName}
            size={28}
          />
          <span className="flex-1 truncate text-body font-medium text-content">
            {displayName}
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`shrink-0 text-content-muted transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          aria-label={t("nav.profile")}
          className="absolute bottom-full left-0 right-0 z-40 mb-1 mx-2 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden"
        >
          {/* Header: name + email so the user has visual confirmation
              of which account the menu acts on (they may have multiple
              tabs across orgs). Not a clickable target — the body
              menuitems carry the actions. */}
          <div className="flex items-center gap-3 px-3 py-2.5 border-b border-edge">
            <Avatar
              avatarUrl={avatarUrl}
              displayName={displayName}
              size={32}
            />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-content truncate">
                {displayName}
              </p>
              <p className="text-caption text-content-muted truncate">
                {email}
              </p>
            </div>
          </div>

          {/* Appearance controls — text size + theme. Inlined as a
              row so the user can flip without leaving the menu. */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-edge">
            <TextSizeSwitcher dense />
            <ThemePickerPopover />
          </div>

          <div className="py-1">
            <Link
              href="/profile"
              role="menuitem"
              onClick={close}
              className={`flex items-center gap-3 px-3 py-2 text-body transition-colors ${
                isProfileActive
                  ? "bg-accent-soft text-accent-text"
                  : "text-content-secondary hover:bg-hover hover:text-content"
              }`}
            >
              <User size={14} className="shrink-0" />
              <span className="flex-1">{t("nav.profile")}</span>
            </Link>
            <Link
              href="/docs"
              role="menuitem"
              onClick={close}
              className={`flex items-center gap-3 px-3 py-2 text-body transition-colors ${
                isDocsActive
                  ? "bg-accent-soft text-accent-text"
                  : "text-content-secondary hover:bg-hover hover:text-content"
              }`}
            >
              <BookOpen size={14} className="shrink-0" />
              <span className="flex-1">{t("nav.docs")}</span>
            </Link>
          </div>

          <div className="border-t border-edge py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onSignOut();
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-body text-content-secondary hover:bg-hover hover:text-content transition-colors"
            >
              <LogOut size={14} className="shrink-0" />
              <span className="flex-1 text-left">{t("actions.signOut")}</span>
            </button>
          </div>
          {/* userId is intentionally unused in the rendered DOM —
              passed in for future "Switch account" flows where the
              menu shows other identities the user has access to. */}
          <span hidden data-user-id={userId} />
        </div>
      )}
    </div>
  );
}
