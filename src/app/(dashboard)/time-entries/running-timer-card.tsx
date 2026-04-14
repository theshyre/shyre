"use client";

import { useEffect, useRef, useState } from "react";
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
import { startTimerAction, stopTimerAction } from "./actions";
import { RecentProjectsChips } from "./recent-projects-chips";
import type { ProjectOption, TimeEntry } from "./types";

interface Props {
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
  orgs: OrgListItem[];
  defaultOrgId?: string;
}

export function RunningTimerCard({
  running,
  projects,
  recentProjects,
  orgs,
  defaultOrgId,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const tf = useTranslations("time.fields");
  const tt = useTranslations("time.timer");
  const th = useTranslations("time.home");

  const startForm = useFormAction({ action: startTimerAction });
  const stopForm = useFormAction({ action: stopTimerAction });

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [elapsed, setElapsed] = useState("00:00:00");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) {
      setElapsed("00:00:00");
      return;
    }
    const tick = () => {
      const diff = Date.now() - new Date(running.start_time).getTime();
      const totalSec = Math.max(0, Math.floor(diff / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setElapsed(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  // Space shortcut — only handle start here (stop is handled by sidebar Timer widget).
  // We only bind start when there's no running timer, to avoid double-handling.
  useEffect(() => {
    if (running) return;
    function handleKey(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;
      if (!selectedProjectId) return;
      e.preventDefault();
      const fd = new FormData();
      fd.set("organization_id", defaultOrgId ?? orgs[0]?.id ?? "");
      fd.set("project_id", selectedProjectId);
      fd.set("description", description);
      void startForm.handleSubmit(fd);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [running, selectedProjectId, description, defaultOrgId, orgs, startForm]);

  if (running) {
    const projectName = running.projects?.name ?? "—";
    return (
      <div className="rounded-lg border border-success/30 bg-success-soft p-6">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-success animate-pulse" />
          <span className="text-sm font-medium text-success">
            {th("runningHeader")}
          </span>
          <kbd className={kbdClass}>Space</kbd>
        </div>
        <p className="mt-3 font-mono text-4xl font-semibold text-content tabular-nums">
          {elapsed}
        </p>
        <p className="mt-2 text-sm text-content">{projectName}</p>
        {running.description && (
          <p className="text-sm text-content-secondary">{running.description}</p>
        )}
        {stopForm.serverError && (
          <p className="mt-2 text-sm text-error bg-error-soft rounded-lg px-3 py-2">
            {stopForm.serverError}
          </p>
        )}
        <form action={stopForm.handleSubmit} className="mt-4">
          <input type="hidden" name="id" value={running.id} />
          <SubmitButton
            label={tt("stop")}
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
      className="space-y-4 rounded-lg border border-edge bg-surface-raised p-6"
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-content-muted" />
        <span className="text-sm font-medium text-content-secondary">
          {th("startPrompt")}
        </span>
        <kbd className={kbdClass}>Space</kbd>
      </div>
      {startForm.serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {startForm.serverError}
        </p>
      )}
      {orgs.length > 1 && <OrgSelector orgs={orgs} defaultOrgId={defaultOrgId} />}
      {orgs.length === 1 && (
        <input type="hidden" name="organization_id" value={orgs[0]?.id ?? ""} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{tf("project")} *</label>
          <select
            name="project_id"
            required
            className={selectClass}
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            autoFocus
          >
            <option value="">{tt("selectProject")}</option>
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tf("descriptionPlaceholder")}
            className={inputClass}
          />
        </div>
      </div>
      {recentProjects.length > 0 && (
        <RecentProjectsChips
          projects={recentProjects}
          onPick={(id) => setSelectedProjectId(id)}
          selectedId={selectedProjectId}
        />
      )}
      <SubmitButton label={tt("start")} pending={startForm.pending} icon={Play} />
    </form>
  );
}
