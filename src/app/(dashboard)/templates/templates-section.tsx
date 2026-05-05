"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Pencil, Trash2, Bookmark } from "lucide-react";
import type { TeamListItem } from "@/lib/team-context";
import type { TimeTemplate } from "@/lib/templates/types";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { TeamSelector } from "@/components/TeamSelector";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
  inputClass,
  selectClass,
  labelClass,
  kbdClass,
} from "@/lib/form-styles";
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
} from "./actions";

interface ProjectOpt {
  id: string;
  name: string;
  team_id: string;
  category_set_id: string | null;
}

interface CategoryOpt {
  id: string;
  category_set_id: string;
  name: string;
  color: string;
  sort_order: number;
}

interface Props {
  teams: TeamListItem[];
  templates: TimeTemplate[];
  projects: ProjectOpt[];
  categories: CategoryOpt[];
}

export function TemplatesSection({
  teams,
  templates,
  projects,
  categories,
}: Props): React.JSX.Element {
  const t = useTranslations("templates");
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setShowNew(true), []),
    enabled: !showNew && editingId === null,
  });

  return (
    <div className="mt-6 space-y-4">
      {!showNew && (
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className={buttonPrimaryClass}
        >
          <Plus size={16} />
          {t("newTemplate")}
          <kbd className={kbdClass}>N</kbd>
        </button>
      )}
      {showNew && (
        <TemplateForm
          teams={teams}
          projects={projects}
          categories={categories}
          onDone={() => setShowNew(false)}
        />
      )}

      {templates.length === 0 && !showNew && (
        <p className="text-body-lg text-content-muted">{t("empty")}</p>
      )}

      <div className="space-y-2">
        {templates.map((tpl) =>
          editingId === tpl.id ? (
            <TemplateForm
              key={tpl.id}
              teams={teams}
              projects={projects}
              categories={categories}
              template={tpl}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <TemplateRow
              key={tpl.id}
              template={tpl}
              projects={projects}
              categories={categories}
              onEdit={() => setEditingId(tpl.id)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  projects,
  categories,
  onEdit,
}: {
  template: TimeTemplate;
  projects: ProjectOpt[];
  categories: CategoryOpt[];
  onEdit: () => void;
}): React.JSX.Element {
  const t = useTranslations("templates");
  const [confirming, setConfirming] = useState(false);
  const deleteForm = useFormAction({ action: deleteTemplateAction });

  const project = projects.find((p) => p.id === template.project_id);
  const category = template.category_id
    ? categories.find((c) => c.id === template.category_id)
    : null;

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Bookmark size={14} className="text-accent shrink-0" />
            <p className="text-body-lg font-medium text-content truncate">
              {template.name}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-caption text-content-secondary">
            <span>{project?.name ?? "—"}</span>
            {template.description && (
              <>
                <span className="text-content-muted">·</span>
                <span className="truncate">{template.description}</span>
              </>
            )}
            {category && (
              <>
                <span className="text-content-muted">·</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  {category.name}
                </span>
              </>
            )}
            <span className="text-content-muted">·</span>
            <span>{template.billable ? t("billable") : t("nonBillable")}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={onEdit} className={buttonGhostClass}>
            <Pencil size={14} />
            {t("edit")}
          </button>
          {confirming ? (
            <form action={deleteForm.handleSubmit}>
              <input type="hidden" name="id" value={template.id} />
              <SubmitButton
                label={t("confirmDelete")}
                pending={deleteForm.pending}
                icon={Trash2}
                className="inline-flex items-center gap-2 rounded-lg bg-error px-3 py-2 text-body-lg font-medium text-content-inverse hover:opacity-90 disabled:opacity-50"
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

function TemplateForm({
  teams,
  projects,
  categories,
  template,
  onDone,
}: {
  teams: TeamListItem[];
  projects: ProjectOpt[];
  categories: CategoryOpt[];
  template?: TimeTemplate;
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations("templates");
  const tc = useTranslations("common");
  const [selectedProjectId, setSelectedProjectId] = useState(
    template?.project_id ?? "",
  );

  const form = useFormAction({
    action: template ? updateTemplateAction : createTemplateAction,
    onSuccess: onDone,
  });

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const filteredCategories = selectedProject?.category_set_id
    ? categories.filter(
        (c) => c.category_set_id === selectedProject.category_set_id,
      )
    : [];

  return (
    <form
      action={form.handleSubmit}
      className="space-y-3 rounded-lg border border-accent bg-surface-raised p-4"
    >
      {form.serverError && (
        <AlertBanner tone="error">{form.serverError}</AlertBanner>
      )}
      {template && <input type="hidden" name="id" value={template.id} />}
      {!template && <TeamSelector teams={teams} />}
      {template && (
        <input
          type="hidden"
          name="team_id"
          value={template.team_id}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.name")} *</label>
          <input
            name="name"
            required
            autoFocus={!template}
            defaultValue={template?.name ?? ""}
            placeholder={t("fields.namePlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("fields.project")} *</label>
          <select
            name="project_id"
            required
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("fields.selectProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>{t("fields.description")}</label>
          <input
            name="description"
            defaultValue={template?.description ?? ""}
            placeholder={t("fields.descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
        {filteredCategories.length > 0 && (
          <div>
            <label className={labelClass}>{t("fields.category")}</label>
            <select
              name="category_id"
              defaultValue={template?.category_id ?? ""}
              className={selectClass}
            >
              <option value="">{t("fields.noCategory")}</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-body-lg font-medium text-content cursor-pointer">
            <input
              name="billable"
              type="checkbox"
              defaultChecked={template?.billable ?? true}
              className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
            />
            {t("fields.billable")}
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <SubmitButton
          label={template ? t("save") : t("create")}
          pending={form.pending}
          success={form.success}
          successMessage={tc("actions.saved")}
        />
        <button
          type="button"
          disabled={form.pending}
          onClick={onDone}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
