"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  inputClass,
  labelClass,
  selectClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { GitHubIssuePicker } from "@/components/GitHubIssuePicker";
import { createTimeEntryAction } from "./actions";

interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
}

export function NewTimeEntryForm({
  projects,
}: {
  projects: ProjectOption[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [issueNumber, setIssueNumber] = useState<number | null>(null);
  const t = useTranslations("time");
  const tc = useTranslations("common");

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const linkedRepo = selectedProject?.github_repo ?? null;

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setOpen(true), []),
    enabled: !open,
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${buttonPrimaryClass} mt-4`}
      >
        <Plus size={16} />
        {t("addEntry")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await createTimeEntryAction(formData);
        setOpen(false);
        setSelectedProjectId("");
        setIssueNumber(null);
      }}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.project")} *</label>
          <select
            name="project_id"
            required
            className={selectClass}
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setIssueNumber(null);
            }}
          >
            <option value="">{t("fields.project")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t("fields.description")}</label>
          <input
            name="description"
            placeholder={t("fields.descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("fields.startTime")} *</label>
          <input
            name="start_time"
            type="datetime-local"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("fields.endTime")}</label>
          <input name="end_time" type="datetime-local" className={inputClass} />
        </div>
        {linkedRepo ? (
          <div>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <GitHubIssuePicker
              repo={linkedRepo}
              value={issueNumber}
              onChange={setIssueNumber}
            />
          </div>
        ) : (
          <div>
            <label className={labelClass}>{t("fields.githubIssue")}</label>
            <input
              name="github_issue"
              type="number"
              min="1"
              className={inputClass}
            />
          </div>
        )}
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm font-medium text-content cursor-pointer">
            <input
              name="billable"
              type="checkbox"
              defaultChecked
              className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
            />
            {t("fields.billable")}
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimaryClass}>
          {t("saveEntry")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
