"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Save, Trash2, X } from "lucide-react";
import type { Category, CategorySetWithCategories } from "@/lib/categories/types";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
  inputClass,
  labelClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  updateCategorySetAction,
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
} from "./actions";

interface Props {
  set: CategorySetWithCategories;
  onDone: () => void;
}

export function CategorySetEditor({ set, onDone }: Props): React.JSX.Element {
  const t = useTranslations("categories");

  const setForm = useFormAction({
    action: updateCategorySetAction,
    onSuccess: () => onDone(),
  });

  return (
    <div className="rounded-lg border border-accent bg-surface-raised p-4 space-y-4">
      {/* Set meta editor */}
      <form action={setForm.handleSubmit} className="space-y-3">
        {setForm.serverError && (
          <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
            {setForm.serverError}
          </p>
        )}
        <input type="hidden" name="id" value={set.id} />
        <input
          type="hidden"
          name="organization_id"
          value={set.organization_id ?? ""}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("name")} *</label>
            <input
              name="name"
              required
              defaultValue={set.name}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("descriptionLabel")}</label>
            <input
              name="description"
              defaultValue={set.description ?? ""}
              className={inputClass}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <SubmitButton label={t("saveSet")} pending={setForm.pending} icon={Save} />
          <button
            type="button"
            disabled={setForm.pending}
            onClick={onDone}
            className={buttonSecondaryClass}
          >
            <X size={14} />
            {t("done")}
          </button>
        </div>
      </form>

      {/* Categories list */}
      <div className="border-t border-edge pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">
          {t("categoriesHeading")}
        </h3>
        <div className="space-y-2">
          {set.categories.map((cat) => (
            <CategoryRow key={cat.id} category={cat} />
          ))}
          <NewCategoryForm setId={set.id} nextSort={nextSortOrder(set.categories)} />
        </div>
      </div>
    </div>
  );
}

function nextSortOrder(categories: Category[]): number {
  if (categories.length === 0) return 10;
  return Math.max(...categories.map((c) => c.sort_order)) + 10;
}

function CategoryRow({ category }: { category: Category }): React.JSX.Element {
  const t = useTranslations("categories");
  const [editing, setEditing] = useState(false);

  const updateForm = useFormAction({
    action: updateCategoryAction,
    onSuccess: () => setEditing(false),
  });
  const deleteForm = useFormAction({ action: deleteCategoryAction });

  if (editing) {
    return (
      <form
        action={updateForm.handleSubmit}
        className="flex items-center gap-2 rounded-md border border-edge bg-surface-inset p-2"
      >
        <input type="hidden" name="id" value={category.id} />
        <input
          type="color"
          name="color"
          defaultValue={category.color}
          aria-label="color"
          className="h-8 w-8 rounded border border-edge cursor-pointer"
        />
        <input
          name="name"
          required
          defaultValue={category.name}
          className={`${inputClass} flex-1`}
        />
        <input
          name="sort_order"
          type="number"
          defaultValue={category.sort_order}
          className={`${inputClass} w-20`}
          aria-label="sort order"
        />
        <SubmitButton label={t("save")} pending={updateForm.pending} icon={Save} />
        <button
          type="button"
          disabled={updateForm.pending}
          onClick={() => setEditing(false)}
          className={buttonGhostClass}
        >
          <X size={14} />
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-inset p-2">
      <span
        className="h-4 w-4 rounded-full shrink-0"
        style={{ backgroundColor: category.color }}
      />
      <span className="flex-1 text-sm text-content">{category.name}</span>
      <span className="text-[11px] font-mono text-content-muted">
        #{category.sort_order}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={buttonGhostClass}
      >
        {t("edit")}
      </button>
      <form action={deleteForm.handleSubmit}>
        <input type="hidden" name="id" value={category.id} />
        <button
          type="submit"
          disabled={deleteForm.pending}
          className={buttonGhostClass}
          aria-label={t("delete")}
        >
          <Trash2 size={14} className="text-error" />
        </button>
      </form>
    </div>
  );
}

function NewCategoryForm({
  setId,
  nextSort,
}: {
  setId: string;
  nextSort: number;
}): React.JSX.Element {
  const t = useTranslations("categories");
  const formAction = useFormAction({ action: createCategoryAction });
  const { pending, serverError, handleSubmit } = formAction;

  return (
    <form
      action={handleSubmit}
      className="flex items-center gap-2 rounded-md border border-dashed border-edge p-2"
    >
      <input type="hidden" name="category_set_id" value={setId} />
      <input type="hidden" name="sort_order" value={nextSort} />
      <input
        type="color"
        name="color"
        defaultValue="#6b7280"
        aria-label="color"
        className="h-8 w-8 rounded border border-edge cursor-pointer"
      />
      <input
        name="name"
        required
        placeholder={t("newCategoryPlaceholder")}
        className={`${inputClass} flex-1`}
      />
      <SubmitButton label={t("addCategory")} pending={pending} icon={Plus} />
      {serverError && (
        <span className="text-xs text-error">{serverError}</span>
      )}
    </form>
  );
}
