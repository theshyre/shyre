"use client";

import { useTranslations } from "next-intl";
import { selectClass, labelClass } from "@/lib/form-styles";
import type { CategoryOption } from "./types";

interface Props {
  /** Full list of categories across all sets — we filter by setId */
  categories: CategoryOption[];
  /** The project's category_set_id (null if project has no set) */
  categorySetId: string | null;
  /** Pre-selected category */
  defaultValue?: string | null;
  /** Controlled value (optional) */
  value?: string;
  onChange?: (id: string) => void;
  /** Hidden when the project has no set — nothing is rendered */
  hideWhenEmpty?: boolean;
}

/**
 * Renders a <select name="category_id"> filtered to categories that belong
 * to the project's category set. If the project has no set, renders nothing
 * (or a notice, depending on `hideWhenEmpty`).
 */
export function CategoryPicker({
  categories,
  categorySetId,
  defaultValue,
  value,
  onChange,
  hideWhenEmpty = true,
}: Props): React.JSX.Element | null {
  const t = useTranslations("categories.entry");

  if (!categorySetId) {
    if (hideWhenEmpty) return null;
    return (
      <div>
        <label className={labelClass}>{t("label")}</label>
        <p className="text-xs text-content-muted italic">{t("notConfigured")}</p>
      </div>
    );
  }

  const filtered = categories.filter((c) => c.category_set_id === categorySetId);
  if (filtered.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div>
        <label className={labelClass}>{t("label")}</label>
        <p className="text-xs text-content-muted italic">{t("notConfigured")}</p>
      </div>
    );
  }

  return (
    <div>
      <label className={labelClass}>{t("label")}</label>
      <select
        name="category_id"
        className={selectClass}
        defaultValue={defaultValue ?? ""}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      >
        <option value="">{t("none")}</option>
        {filtered.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A small colored dot + label pill for rendering a category on a card.
 */
export function CategoryBadge({
  category,
}: {
  category: CategoryOption;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-1.5 py-0.5 text-[10px] text-content-secondary">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: category.color }}
      />
      {category.name}
    </span>
  );
}
