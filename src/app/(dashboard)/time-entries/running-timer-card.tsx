"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Plus, X } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonPrimaryClass,
  buttonGhostClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
  selectClass,
  kbdClass,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import { TicketField, ticketFieldVisible } from "@/components/TicketField";
import {
  ProjectPicker,
  type ProjectPickerOption,
} from "@/components/ProjectPicker";
import type { TeamListItem } from "@/lib/team-context";
import { startTimerAction } from "./actions";
import { notifyTimerChanged } from "@/lib/timer-events";
import { localDayBoundsIso } from "@/lib/local-day-bounds";
import { RecentProjectsChips } from "./recent-projects-chips";
import { TemplateChips } from "./template-chips";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";
import type { TimeTemplate } from "@/lib/templates/types";

interface Props {
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
  teams: TeamListItem[];
  defaultTeamId?: string;
  categories: CategoryOption[];
  templates?: TimeTemplate[];
  tzOffsetMin?: number;
}

export function RunningTimerCard({
  running,
  projects,
  recentProjects,
  teams,
  defaultTeamId,
  categories,
  templates = [],
}: Props): React.JSX.Element {
  const tf = useTranslations("time.fields");
  const tt = useTranslations("time.timer");
  const th = useTranslations("time.home");
  const tc = useTranslations("common");

  const [expanded, setExpanded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [description, setDescription] = useState("");

  // Collapse + reset the start form when the action succeeds. Without
  // this, the local `expanded` state persisted through the timer's
  // lifecycle: user hits Start → form submits → `running` becomes
  // non-null → the card returns empty. When the sidebar later stops
  // the timer, `running` goes null and the card re-renders with
  // `expanded === true` still, re-opening the form on top of the
  // now-empty state. Doing the reset in onSuccess instead of an
  // effect keeps it out of the running → null render path.
  const startForm = useFormAction({
    action: startTimerAction,
    onSuccess: () => {
      notifyTimerChanged();
      setExpanded(false);
      setSelectedProjectId("");
      setDescription("");
    },
  });

  // Space shortcut: opens the start form when collapsed + no running timer;
  // submits it when expanded + project selected. The sidebar <Timer>
  // widget owns the running → stopped direction. This component only
  // handles the stopped → start path.
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
        fd.set("team_id", defaultTeamId ?? teams[0]?.id ?? "");
        fd.set("project_id", selectedProjectId);
        fd.set("description", description);
        // Same intent flag as the form's hidden input — keeps the
        // Space-shortcut submission path in sync with form-button
        // submission. Without this, Space-to-start would still hit
        // the resume-same-day path.
        fd.set("force_new", "1");
        // Mirror the form's TicketField input so a Space-triggered
        // submit also carries the ticket reference. Without this,
        // pressing Space to start would silently drop whatever the
        // user typed in "Jira issue" / "GitHub issue".
        if (typeof document !== "undefined") {
          const ticketInput = document.querySelector<HTMLInputElement>(
            "input[name='ticket_ref']",
          );
          if (ticketInput?.value) {
            fd.set("ticket_ref", ticketInput.value);
          }
        }
        const [dayStart, dayEnd] = localDayBoundsIso();
        fd.set("day_start_iso", dayStart);
        fd.set("day_end_iso", dayEnd);
        void startForm.handleSubmit(fd);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [running, expanded, selectedProjectId, description, defaultTeamId, teams, startForm]);

  // A running timer is owned by the sidebar <Timer> — this component
  // renders nothing in that state so we don't duplicate the surface.
  if (running) return <></>;

  // --- Collapsed state: just the Start button. Uses Plus icon (not
  // just Play) to visually differentiate from the per-row Play
  // button on the week timesheet — both used to share an icon and
  // confused users about which intent they were triggering. This
  // header button always opens the project picker (i.e. creates a
  // NEW entry); the row Play button operates on an existing row's
  // project + category for today's date.
  if (!expanded) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={buttonPrimaryClass}
          aria-label={th("startNewTimerAria")}
        >
          <Plus size={14} />
          {th("startNewTimer")}
          <kbd className={kbdClass}>Space</kbd>
        </button>
        {templates.length > 0 && <TemplateChips templates={templates} />}
      </div>
    );
  }

  // --- Expanded state: compact start form (Category → Project → Description)
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const projectCategorySetId = selectedProject?.category_set_id ?? null;
  const availableCategories = projectCategorySetId
    ? categories.filter((c) => c.category_set_id === projectCategorySetId)
    : [];
  // Category is required when the project has a category set
  const categoryRequired = !!projectCategorySetId && availableCategories.length > 0;

  const hasQuickPath = recentProjects.length > 0 || templates.length > 0;

  return (
    <form
      action={startForm.handleSubmit}
      className="space-y-4 rounded-lg border border-accent bg-surface-raised p-4 max-w-[672px]"
    >
      <div className="flex items-center justify-between">
        <span className="text-label font-semibold uppercase tracking-wider text-content-muted">
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
        <AlertBanner tone="error">{startForm.serverError}</AlertBanner>
      )}

      {/* Local-day bounds so the server can decide resume vs. insert. */}
      {(() => {
        const [dayStart, dayEnd] = localDayBoundsIso();
        return (
          <>
            <input type="hidden" name="day_start_iso" value={dayStart} />
            <input type="hidden" name="day_end_iso" value={dayEnd} />
          </>
        );
      })()}
      {/* This form's intent is always "create a new entry" — the
          header button differentiates from row-Play (resume same-day
          work) and per-template chips (resume). Without this, the
          user clicking "New timer" on the SAME (project, category) as
          a morning's work hijacked the existing entry and backdated
          start_time, instead of spawning the sibling entry the user
          actually wanted (e.g. same project but different ticket). */}
      <input type="hidden" name="force_new" value="1" />

      {/* Quick-path chip strip — the fastest route to start is "click a
          recent or saved template", so these live at the top above the
          full fieldset. Wrapped in an inset panel so they read as one
          affordance, not two bolt-ons below the form. */}
      {hasQuickPath && (
        <div className="rounded-md bg-surface-inset p-3 space-y-3">
          {recentProjects.length > 0 && (
            <RecentProjectsChips
              projects={recentProjects}
              onPick={(id) => setSelectedProjectId(id)}
              selectedId={selectedProjectId}
            />
          )}
          {templates.length > 0 && <TemplateChips templates={templates} />}
        </div>
      )}

      {teams.length > 1 && <TeamSelector teams={teams} defaultTeamId={defaultTeamId} />}
      {teams.length === 1 && (
        <input type="hidden" name="team_id" value={teams[0]?.id ?? ""} />
      )}

      {/* Project — the gating required field. Everything else downstream
          (Category availability, description context) is derived from
          this pick, so it leads. */}
      <div>
        <label className={labelClass}>{tf("project")} *</label>
        <ProjectPicker
          name="project_id"
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          required
          autoFocus
          ariaLabel={tf("project")}
          placeholder={tt("selectProject")}
          projects={projects.map<ProjectPickerOption>((p) => ({
            id: p.id,
            name: p.name,
            parent_project_id: p.parent_project_id ?? null,
            customer_name: p.customers?.name ?? null,
            is_internal: p.is_internal === true,
          }))}
          recentIds={recentProjects.map((r) => r.id)}
        />
      </div>

      {/* Category — only rendered when the picked project has a set and
          a required selection is actually needed. When the project has
          no category set we don't render anything; when no project is
          picked we don't render either (Project is already autofocused
          so the user knows what to do first). */}
      {categoryRequired && (
        <div>
          <label className={labelClass}>{tf("category")} *</label>
          <select
            name="category_id"
            required
            className={selectClass}
            defaultValue=""
          >
            <option value="" disabled>
              {tt("selectCategory")}
            </option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Ticket field — only rendered when the chosen project has at
          least one provider configured (Jira key or GitHub repo). The
          server reads `ticket_ref` and, when description is empty,
          back-fills it with "{key} {title}" so the running timer's
          chip + the day-view row both read naturally without the
          user typing anything in Description. */}
      {selectedProject &&
        ticketFieldVisible(
          selectedProject.github_repo,
          selectedProject.jira_project_key,
        ) && (
          <TicketField
            idPrefix="new-timer"
            githubRepo={selectedProject.github_repo}
            jiraProjectKey={selectedProject.jira_project_key}
          />
        )}

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

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
        <SubmitButton
          label={tt("start")}
          pending={startForm.pending}
          icon={Play}
        />
      </div>
    </form>
  );
}

