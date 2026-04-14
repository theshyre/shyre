"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Square, X } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonPrimaryClass,
  buttonGhostClass,
  inputClass,
  labelClass,
  selectClass,
  kbdClass,
} from "@/lib/form-styles";
import { OrgSelector } from "@/components/OrgSelector";
import type { OrgListItem } from "@/lib/org-context";
import { startTimerAction, stopTimerAction } from "./actions";
import { RecentProjectsChips } from "./recent-projects-chips";
import { CategoryPicker } from "./category-picker";
import { TemplateChips } from "./template-chips";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";
import type { TimeTemplate } from "@/lib/templates/types";

interface Props {
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
  orgs: OrgListItem[];
  defaultOrgId?: string;
  categories: CategoryOption[];
  templates?: TimeTemplate[];
}

export function RunningTimerCard({
  running,
  projects,
  recentProjects,
  orgs,
  defaultOrgId,
  categories,
  templates = [],
}: Props): React.JSX.Element {
  const tf = useTranslations("time.fields");
  const tt = useTranslations("time.timer");
  const th = useTranslations("time.home");

  const startForm = useFormAction({ action: startTimerAction });
  const stopForm = useFormAction({ action: stopTimerAction });

  const [expanded, setExpanded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [elapsed, setElapsed] = useState("00:00:00");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live-tick the elapsed clock when a timer is running
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

  // Space shortcut: opens the start form when collapsed + no running timer;
  // submits it when expanded + project selected. Sidebar Timer widget handles
  // stopping, so we don't bind that here.
  useEffect(() => {
    if (running) return;
    function handleKey(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;
      e.preventDefault();
      if (!expanded) {
        setExpanded(true);
      } else if (selectedProjectId) {
        const fd = new FormData();
        fd.set("organization_id", defaultOrgId ?? orgs[0]?.id ?? "");
        fd.set("project_id", selectedProjectId);
        fd.set("description", description);
        void startForm.handleSubmit(fd);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [running, expanded, selectedProjectId, description, defaultOrgId, orgs, startForm]);

  // --- Running state: live clock + Stop button
  if (running) {
    const projectName = running.projects?.name ?? "—";
    const clientName = running.projects?.clients?.name ?? null;
    return (
      <div className="rounded-lg border border-success/30 bg-success-soft p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-medium text-success uppercase tracking-wider">
            {th("runningHeader")}
          </span>
        </div>
        <span className="font-mono text-2xl font-semibold text-content tabular-nums">
          {elapsed}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-content truncate">
            {projectName}
            {clientName && (
              <span className="text-content-muted">
                {" "}· {clientName}
              </span>
            )}
          </p>
          {running.description && (
            <p className="text-xs text-content-secondary truncate">
              {running.description}
            </p>
          )}
        </div>
        {stopForm.serverError && (
          <p className="text-xs text-error bg-error-soft rounded-md px-2 py-1">
            {stopForm.serverError}
          </p>
        )}
        <form action={stopForm.handleSubmit}>
          <input type="hidden" name="id" value={running.id} />
          <SubmitButton
            label={tt("stop")}
            pending={stopForm.pending}
            icon={Square}
            className="flex items-center gap-2 rounded-lg bg-error px-3 py-2 text-sm font-medium text-content-inverse hover:opacity-90 transition-colors disabled:opacity-50"
          />
        </form>
      </div>
    );
  }

  // --- Collapsed state: just the Start button (Harvest-style)
  if (!expanded) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={buttonPrimaryClass}
        >
          <Play size={14} />
          {th("startNewTimer")}
          <kbd className={kbdClass}>Space</kbd>
        </button>
        {templates.length > 0 && <TemplateChips templates={templates} />}
      </div>
    );
  }

  // --- Expanded state: compact start form
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  return (
    <form
      action={startForm.handleSubmit}
      className="space-y-3 rounded-lg border border-accent bg-surface-raised p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          {th("startNewTimer")}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={buttonGhostClass}
          aria-label="Close"
        >
          <X size={14} />
        </button>
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

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr]">
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
                {p.clients?.name ? ` · ${p.clients.name}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <CategoryPicker
            categories={categories}
            categorySetId={selectedProject?.category_set_id ?? null}
          />
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

      {templates.length > 0 && <TemplateChips templates={templates} />}

      <div className="flex gap-2">
        <SubmitButton
          label={tt("start")}
          pending={startForm.pending}
          icon={Play}
        />
      </div>
    </form>
  );
}
