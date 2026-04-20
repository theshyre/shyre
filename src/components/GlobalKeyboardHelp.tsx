"use client";

import { useTranslations } from "next-intl";
import { KeyboardHelp, type ShortcutGroup } from "@theshyre/ui";

/**
 * `?` opens a modal listing every keyboard shortcut Shyre defines.
 * Mounted once in the dashboard layout — the `useKeyboardShortcut`
 * hook inside `<KeyboardHelp>` bails when an input is focused, so
 * typing a literal "?" in a field doesn't fire it.
 *
 * Shortcuts are wired individually in their feature components
 * (week-timesheet, view-toggle, new-*-form, etc.). This surface is
 * discoverability only — we don't centralize the wiring.
 */
export function GlobalKeyboardHelp(): React.JSX.Element {
  const t = useTranslations("common.keyboardHelp");

  const groups: ShortcutGroup[] = [
    {
      title: t("groups.global"),
      shortcuts: [
        { keys: "?", description: t("shortcuts.showHelp") },
        { keys: "⌘K", description: t("shortcuts.commandPalette") },
        { keys: "/", description: t("shortcuts.focusSearch") },
        { keys: "N", description: t("shortcuts.newItem") },
        { keys: "Escape", description: t("shortcuts.closeOrCancel") },
      ],
    },
    {
      title: t("groups.time"),
      shortcuts: [
        { keys: "Space", description: t("shortcuts.startStopTimer") },
        { keys: "D", description: t("shortcuts.dayView") },
        { keys: "W", description: t("shortcuts.weekView") },
        { keys: "⇧E", description: t("shortcuts.expandAllGroups") },
        { keys: "⇧C", description: t("shortcuts.collapseAllGroups") },
      ],
    },
    {
      title: t("groups.forms"),
      shortcuts: [
        { keys: "⌘S", description: t("shortcuts.save") },
        { keys: "⌘↵", description: t("shortcuts.submit") },
      ],
    },
  ];

  return <KeyboardHelp groups={groups} title={t("title")} />;
}
