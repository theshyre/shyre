"use client";

import { useTranslations } from "next-intl";
import { selectClass, labelClass } from "@/lib/form-styles";
import type { CategoryOption } from "./types";

interface Props {
  /** Full list of categories across all sets — we filter by setIds */
  categories: CategoryOption[];
  /**
   * Category set ids to pull from — typically the project's base set +
   * its project-scoped extension set (if any). Callers pass the array
   * so a project with both can show base + project-specific categories
   * in one dropdown. Accepts the legacy single-id prop for compatibility.
   */
  categorySetIds?: Array<string | null | undefined>;
  /** @deprecated pass categorySetIds instead */
  categorySetId?: string | null;
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
  categorySetIds,
  categorySetId,
  defaultValue,
  value,
  onChange,
  hideWhenEmpty = true,
}: Props): React.JSX.Element | null {
  const t = useTranslations("categories.entry");

  // Build the effective set-id list from either the new array prop or
  // the legacy single id, stripping nullish.
  const effectiveSetIds = (
    categorySetIds ?? (categorySetId ? [categorySetId] : [])
  ).filter((id): id is string => !!id);

  if (effectiveSetIds.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div>
        <label className={labelClass}>{t("label")}</label>
        <p className="text-caption text-content-muted italic">{t("notConfigured")}</p>
      </div>
    );
  }

  const filtered = categories.filter((c) =>
    effectiveSetIds.includes(c.category_set_id),
  );
  if (filtered.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div>
        <label className={labelClass}>{t("label")}</label>
        <p className="text-caption text-content-muted italic">{t("notConfigured")}</p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="time-entries-category-picker-label" className={labelClass}>{t("label")}</label>
      <select id="time-entries-category-picker-label"
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
