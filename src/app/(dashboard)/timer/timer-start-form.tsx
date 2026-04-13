"use client";

import { useTranslations } from "next-intl";
import { Play, Square } from "lucide-react";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  kbdClass,
} from "@/lib/form-styles";
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
}: {
  projects: ProjectOption[];
  running: RunningEntry | null;
}): React.JSX.Element {
  const t = useTranslations("time.timer");
  const tf = useTranslations("time.fields");

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
        <form action={stopTimerAction} className="mt-4">
          <input type="hidden" name="id" value={running.id} />
          <button
            type="submit"
            className="flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-medium text-content-inverse hover:opacity-90 transition-colors"
          >
            <Square size={16} />
            {t("stop")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <form
      action={startTimerAction}
      className="mt-6 space-y-4 rounded-lg border border-edge bg-surface-raised p-6"
    >
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
      <button type="submit" className={buttonPrimaryClass}>
        <Play size={16} />
        {t("start")}
        <kbd className={kbdClass}>Space</kbd>
      </button>
    </form>
  );
}
