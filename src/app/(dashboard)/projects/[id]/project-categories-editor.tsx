"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Tags, Settings } from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import {
  upsertProjectCategoriesAction,
  deleteProjectCategoriesAction,
} from "../actions";

interface Category {
  id?: string;
  name: string;
  color: string;
  sort_order: number;
}

interface BaseCategory {
  id: string;
  name: string;
  color: string;
}

interface Props {
  projectId: string;
  /** Null when the project has no project-scoped extension set yet. */
  setId: string | null;
  setName: string;
  initialCategories: Category[];
  /** Name of the project's base (system/team) set, if any, for header. */
  baseSetName: string | null;
  /** Categories from the base set — rendered read-only above the
   *  editable list so the user can see what they already have before
   *  adding project-specific extensions. */
  baseCategories: BaseCategory[];
}

// Curated palette — same hues the system seed sets use so project and
// built-in categories visually belong to the same family.
const PALETTE = [
  "#3b82f6", "#ef4444", "#8b5cf6", "#f59e0b", "#10b981",
  "#6366f1", "#ec4899", "#f97316", "#06b6d4", "#64748b",
  "#9ca3af",
];

const DEFAULT_NEW: Omit<Category, "sort_order"> = {
  name: "",
  color: "#3b82f6",
};

export function ProjectCategoriesEditor({
  projectId,
  setId,
  setName: initialSetName,
  initialCategories,
  baseSetName,
  baseCategories,
}: Props): React.JSX.Element {
  const t = useTranslations("projects.projectCategories");
  const tc = useTranslations("common");
  const [expanded, setExpanded] = useState(initialCategories.length > 0);
  const [setName, setSetName] = useState(
    initialSetName || t("defaultSetName"),
  );
  const [categories, setCategories] = useState<Category[]>(initialCategories);

  const upsert = useFormAction({ action: upsertProjectCategoriesAction });
  const removeForm = useFormAction({ action: deleteProjectCategoriesAction });

  function addRow(): void {
    setCategories((prev) => [
      ...prev,
      { ...DEFAULT_NEW, sort_order: (prev.at(-1)?.sort_order ?? 0) + 10 },
    ]);
  }

  function updateRow(i: number, patch: Partial<Category>): void {
    setCategories((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(i: number): void {
    setCategories((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave(): Promise<void> {
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("set_name", setName.trim() || t("defaultSetName"));
    fd.set(
      "categories",
      JSON.stringify(
        categories
          .filter((c) => c.name.trim())
          .map((c, i) => ({ ...c, sort_order: (i + 1) * 10 })),
      ),
    );
    await upsert.handleSubmit(fd);
  }

  async function handleRemove(): Promise<void> {
    const fd = new FormData();
    fd.set("project_id", projectId);
    await removeForm.handleSubmit(fd);
    setCategories([]);
    setExpanded(false);
  }

  if (!expanded && !setId) {
    return (
      <div className="rounded-lg border border-dashed border-edge bg-surface-inset p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Tags size={18} className="text-accent shrink-0" />
          <div className="flex-1">
            <p className="text-body-lg font-medium text-content">
              {t("enableTitle")}
            </p>
            <p className="text-caption text-content-muted">{t("enableHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={buttonSecondaryClass}
          >
            <Plus size={14} />
            {t("enableButton")}
          </button>
        </div>
        {baseCategories.length > 0 && (
          <BaseCategoriesPreview
            baseSetName={baseSetName}
            baseCategories={baseCategories}
          />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-accent" />
          <h3 className="text-title font-semibold text-content">
            {t("title")}
          </h3>
        </div>
        {setId && (
          <InlineDeleteRowConfirm
            ariaLabel={t("deleteSet")}
            onConfirm={handleRemove}
            summary={t("deleteSummary")}
          />
        )}
      </div>

      {upsert.serverError && (
        <p className="text-body text-error bg-error-soft rounded-lg px-3 py-2">
          {upsert.serverError}
        </p>
      )}

      {baseCategories.length > 0 && (
        <BaseCategoriesPreview
          baseSetName={baseSetName}
          baseCategories={baseCategories}
        />
      )}

      <div>
        <label className={labelClass}>{t("setName")}</label>
        <input
          value={setName}
          onChange={(e) => setSetName(e.target.value)}
          placeholder={t("defaultSetName")}
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <label className={labelClass}>{t("additionsLabel")}</label>
        {categories.length === 0 && (
          <p className="text-caption text-content-muted">{t("emptyHint")}</p>
        )}
        {categories.map((cat, i) => (
          <div
            key={cat.id ?? `new-${i}`}
            className="flex items-center gap-2"
          >
            <ColorSwatchPicker
              value={cat.color}
              onChange={(c) => updateRow(i, { color: c })}
            />
            <input
              value={cat.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder={t("categoryNamePlaceholder")}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              aria-label={t("removeCategory")}
              className="rounded p-1 text-content-muted hover:bg-hover hover:text-error transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className={`${buttonGhostClass} text-body-lg`}
        >
          <Plus size={14} />
          {t("addCategory")}
        </button>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-edge">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={upsert.pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={upsert.pending}
          className={buttonPrimaryClass}
        >
          {upsert.pending
            ? tc("saveStatus.saving")
            : upsert.success
              ? tc("actions.saved")
              : tc("actions.save")}
        </button>
      </div>
    </div>
  );
}

function BaseCategoriesPreview({
  baseSetName,
  baseCategories,
}: {
  baseSetName: string | null;
  baseCategories: BaseCategory[];
}): React.JSX.Element {
  const t = useTranslations("projects.projectCategories");
  return (
    <div className="rounded-md border border-edge-muted bg-surface-inset px-3 py-2">
      <p className="text-caption text-content-muted mb-1.5">
        {baseSetName
          ? t("baseFromNamed", { name: baseSetName })
          : t("baseFromUnnamed")}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {baseCategories.map((c) => (
          <li
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-caption text-content"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: c.color }}
            />
            {c.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Pick color"
        onClick={() => setOpen((p) => !p)}
        className="h-8 w-8 rounded-md border border-edge shrink-0"
        style={{ backgroundColor: value }}
      />
      {open && (
        <div className="absolute z-10 mt-1 flex flex-wrap gap-1 rounded-md border border-edge bg-surface-raised p-2 w-48 shadow-lg">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="h-6 w-6 rounded"
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}
