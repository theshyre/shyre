"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tag, FolderKanban } from "lucide-react";
import { EXPENSE_CATEGORIES } from "./categories";
import { getCategoryHelp } from "./categories-help";
import type { ProjectOption } from "./page";

interface CategoryProps {
  onSelect: (category: string) => Promise<void>;
}

/**
 * Dropdown picker for the bulk-action toolbar's "Set category"
 * button. Opens a small menu of every allowed category; clicking
 * one closes the menu and invokes `onSelect`. Click-outside
 * dismisses without firing the action.
 */
export function BulkCategoryPicker({
  onSelect,
}: CategoryProps): React.JSX.Element {
  const t = useTranslations("expenses");
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1 text-caption font-medium text-content hover:bg-hover transition-colors"
      >
        <Tag size={12} />
        {t("bulk.setCategory")}
      </button>
      {open && (
        <>
          {/* Click-outside dismiss. Pointer-events on the overlay
              capture the click; setOpen(false) runs synchronously
              before the dropdown's own onClick fires. */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-[320px] max-h-[420px] overflow-y-auto rounded-md border border-edge bg-surface-raised shadow-md"
          >
            {EXPENSE_CATEGORIES.map((c) => {
              const help = getCategoryHelp(c, t);
              return (
                <button
                  key={c}
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setOpen(false);
                    await onSelect(c);
                  }}
                  className="block w-full text-left px-3 py-2 hover:bg-hover border-b border-edge-muted last:border-0"
                >
                  <span className="block text-body font-medium text-content">
                    {t(`categories.${c}`)}
                  </span>
                  <span className="mt-0.5 block text-caption text-content-muted line-clamp-2">
                    {help.description}
                  </span>
                  <span className="mt-0.5 block text-caption text-content-muted italic line-clamp-1">
                    {help.examples}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface ProjectProps {
  projects: ProjectOption[];
  onSelect: (projectId: string) => Promise<void>;
}

/**
 * Dropdown picker for the bulk-action toolbar's "Set project"
 * button. First option is "No project" (empty string), which
 * clears the link via `bulkUpdateExpenseProjectAction`. Disabled
 * when the team has no active projects.
 */
export function BulkProjectPicker({
  projects,
  onSelect,
}: ProjectProps): React.JSX.Element {
  const t = useTranslations("expenses");
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={projects.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-3 py-1 text-caption font-medium text-content hover:bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderKanban size={12} />
        {t("bulk.setProject")}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-[240px] max-h-[320px] overflow-y-auto rounded-md border border-edge bg-surface-raised shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await onSelect("");
              }}
              className="block w-full text-left px-3 py-1.5 text-caption text-content-muted italic hover:bg-hover border-b border-edge-muted"
            >
              {t("noProject")}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                onClick={async () => {
                  setOpen(false);
                  await onSelect(p.id);
                }}
                className="block w-full text-left px-3 py-1.5 text-caption text-content hover:bg-hover truncate"
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
