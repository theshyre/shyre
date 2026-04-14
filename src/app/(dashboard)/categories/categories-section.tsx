"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Copy, Trash2, Pencil } from "lucide-react";
import type { OrgListItem } from "@/lib/org-context";
import type { CategorySetWithCategories } from "@/lib/categories/types";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
  inputClass,
  labelClass,
  kbdClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { OrgSelector } from "@/components/OrgSelector";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  createCategorySetAction,
  cloneCategorySetAction,
  deleteCategorySetAction,
} from "./actions";
import { CategorySetEditor } from "./category-set-editor";

interface Props {
  orgs: OrgListItem[];
  sets: CategorySetWithCategories[];
}

export function CategoriesSection({ orgs, sets }: Props): React.JSX.Element {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const [showCreate, setShowCreate] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);

  const systemSets = sets.filter((s) => s.is_system);
  const orgSets = sets.filter((s) => !s.is_system);

  useKeyboardShortcut({
    key: "n",
    onTrigger: () => setShowCreate(true),
    enabled: !showCreate && editingSetId === null,
  });

  return (
    <div className="mt-6 space-y-8">
      {/* System sets */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted mb-2">
          {t("systemSets")}
        </h2>
        <p className="text-xs text-content-muted mb-3">{t("systemSetsHelp")}</p>
        <div className="space-y-2">
          {systemSets.map((set) => (
            <SystemSetRow key={set.id} set={set} orgs={orgs} />
          ))}
        </div>
      </section>

      {/* Org sets */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            {t("yourSets")}
          </h2>
          {!showCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className={buttonPrimaryClass}
            >
              <Plus size={16} />
              {t("newSet")}
              <kbd className={kbdClass}>N</kbd>
            </button>
          )}
        </div>

        {showCreate && (
          <NewSetForm
            orgs={orgs}
            onCancel={() => setShowCreate(false)}
            onCreated={() => setShowCreate(false)}
          />
        )}

        <div className="mt-3 space-y-2">
          {orgSets.length === 0 && !showCreate && (
            <p className="text-sm text-content-muted">{t("noSetsYet")}</p>
          )}
          {orgSets.map((set) =>
            editingSetId === set.id ? (
              <CategorySetEditor
                key={set.id}
                set={set}
                onDone={() => setEditingSetId(null)}
              />
            ) : (
              <OrgSetRow
                key={set.id}
                set={set}
                onEdit={() => setEditingSetId(set.id)}
              />
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function SystemSetRow({
  set,
  orgs,
}: {
  set: CategorySetWithCategories;
  orgs: OrgListItem[];
}): React.JSX.Element {
  const t = useTranslations("categories");
  const [cloning, setCloning] = useState(false);
  const { pending, serverError, handleSubmit } = useFormAction({
    action: cloneCategorySetAction,
    onSuccess: () => setCloning(false),
  });

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-content">{set.name}</p>
          {set.description && (
            <p className="text-xs text-content-secondary">{set.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {set.categories.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] text-content-secondary"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCloning((c) => !c)}
          className={buttonSecondaryClass}
        >
          <Copy size={14} />
          {t("clone")}
        </button>
      </div>
      {cloning && (
        <form action={handleSubmit} className="mt-3 space-y-2 border-t border-edge pt-3">
          {serverError && (
            <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
              {serverError}
            </p>
          )}
          <input type="hidden" name="source_id" value={set.id} />
          <OrgSelector orgs={orgs} label={t("cloneToOrg")} />
          <div>
            <label className={labelClass}>{t("nameOptional")}</label>
            <input
              name="name"
              placeholder={set.name}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <SubmitButton label={t("cloneConfirm")} pending={pending} icon={Copy} />
            <button
              type="button"
              disabled={pending}
              onClick={() => setCloning(false)}
              className={buttonSecondaryClass}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function OrgSetRow({
  set,
  onEdit,
}: {
  set: CategorySetWithCategories;
  onEdit: () => void;
}): React.JSX.Element {
  const t = useTranslations("categories");
  const { pending, handleSubmit } = useFormAction({
    action: deleteCategorySetAction,
  });
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-content">{set.name}</p>
          {set.description && (
            <p className="text-xs text-content-secondary">{set.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {set.categories.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] text-content-secondary"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
              </span>
            ))}
            {set.categories.length === 0 && (
              <span className="text-[11px] text-content-muted italic">
                {t("noCategories")}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className={buttonGhostClass}>
            <Pencil size={14} />
            {t("edit")}
          </button>
          {confirming ? (
            <form action={handleSubmit}>
              <input type="hidden" name="id" value={set.id} />
              <input
                type="hidden"
                name="organization_id"
                value={set.organization_id ?? ""}
              />
              <SubmitButton
                label={t("confirmDelete")}
                pending={pending}
                icon={Trash2}
                className="inline-flex items-center gap-2 rounded-lg bg-error px-3 py-2 text-sm font-medium text-content-inverse hover:opacity-90 transition-colors disabled:opacity-50"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={buttonGhostClass}
            >
              <Trash2 size={14} className="text-error" />
              <span className="text-error">{t("delete")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewSetForm({
  orgs,
  onCancel,
  onCreated,
}: {
  orgs: OrgListItem[];
  onCancel: () => void;
  onCreated: () => void;
}): React.JSX.Element {
  const t = useTranslations("categories");
  const { pending, serverError, handleSubmit } = useFormAction({
    action: createCategorySetAction,
    onSuccess: onCreated,
  });

  return (
    <form
      action={handleSubmit}
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}
      <OrgSelector orgs={orgs} />
      <div>
        <label className={labelClass}>{t("name")} *</label>
        <input
          autoFocus
          required
          name="name"
          placeholder={t("namePlaceholder")}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t("descriptionLabel")}</label>
        <input
          name="description"
          placeholder={t("descriptionPlaceholder")}
          className={inputClass}
        />
      </div>
      <div className="flex gap-2">
        <SubmitButton label={t("createSet")} pending={pending} icon={Plus} />
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className={buttonSecondaryClass}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
