"use client";

import { useTranslations } from "next-intl";
import { Play, Square } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  selectClass,
  kbdClass,
} from "@/lib/form-styles";
import { OrgSelector } from "@/components/OrgSelector";
import type { OrgListItem } from "@/lib/org-context";
import {
  startTimerAction,
  stopTimerAction,
} from "../time-entries/actions";

interface ProjectOption {
  id: string;
  name: string;
}

interface RunningEntry {
  id: string;
  project_id: string;
  description: string | null;
  start_time: string;
}

export function TimerStartForm({
  projects,
  running,
  orgs,
}: {
  projects: ProjectOption[];
  running: RunningEntry | null;
  orgs: OrgListItem[];
}): React.JSX.Element {
  const t = useTranslations("time.timer");
  const tf = useTranslations("time.fields");

  const startForm = useFormAction({
    action: startTimerAction,
  });

  const stopForm = useFormAction({
    action: stopTimerAction,
  });

  if (running) {
    return (
      <div className="mt-6 rounded-lg border border-success/30 bg-success-soft p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="h-3 w-3 rounded-full bg-success animate-pulse" />
          <span className="text-sm font-medium text-success">
            {t("running")}
          </span>
          <kbd className={kbdClass}>Space</kbd>
        </div>
        <p className="text-content-secondary text-sm">
          {running.description || "—"}
        </p>
        <p className="text-xs text-content-muted mt-1">
          Started {new Date(running.start_time).toLocaleTimeString()}
        </p>
        {stopForm.serverError && (
          <p className="mt-2 text-sm text-error bg-error-soft rounded-lg px-3 py-2">{stopForm.serverError}</p>
        )}
        <form action={stopForm.handleSubmit} className="mt-4">
          <input type="hidden" name="id" value={running.id} />
          <SubmitButton
            label={t("stop")}
            pending={stopForm.pending}
            icon={Square}
            className="flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-medium text-content-inverse hover:opacity-90 transition-colors disabled:opacity-50"
          />
        </form>
      </div>
    );
  }

  return (
    <form
      action={startForm.handleSubmit}
      className="mt-6 space-y-4 rounded-lg border border-edge bg-surface-raised p-6"
    >
      {startForm.serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">{startForm.serverError}</p>
      )}
      <OrgSelector orgs={orgs} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{tf("project")} *</label>
          <select name="project_id" required className={selectClass}>
            <option value="">{t("selectProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>{tf("description")}</label>
          <input
            name="description"
            placeholder={tf("descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
      </div>
      <SubmitButton label={t("start")} pending={startForm.pending} icon={Play} />
    </form>
  );
}
