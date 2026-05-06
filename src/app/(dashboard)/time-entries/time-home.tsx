"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock, Trash2 } from "lucide-react";
import { TeamFilter } from "@/components/TeamFilter";
import { MemberFilter, type MemberOption } from "./member-filter";
import {
  ProjectFilter,
  type ProjectFilterOption,
} from "@/components/ProjectFilter";
import type { MemberSelection } from "./page";
import type { TeamListItem } from "@/lib/team-context";
import {
  formatDurationHM,
  formatDurationHMZero,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import type { TimeTemplate } from "@/lib/templates/types";
import { RunningTimerCard } from "./running-timer-card";
import { BillableFilter } from "./billable-filter";
import { ExportButton } from "./export-button";
import { ViewToggle, type TimeView } from "./view-toggle";
import { WeekTimesheet } from "./week-timesheet";
import { DayView } from "./day-view";
import { LogView } from "./log-view";
import { NewTimeEntryForm } from "./new-time-entry-form";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface TimeHomeProps {
  teams: TeamListItem[];
  selectedTeamId: string | null;
  view: TimeView;
  billableOnly: boolean;
  /** Local date being viewed (YYYY-MM-DD in user's TZ) */
  dayStr: string;
  /** Local date of the Monday of the visible week (YYYY-MM-DD in user's TZ) */
  weekStartStr: string;
  /** Newest day visible in the Log view (YYYY-MM-DD, user's TZ).
   *  Defaults to today when `?anchor=` isn't set. */
  anchorStr: string;
  /** Today (YYYY-MM-DD, user's TZ). Drives the Log view's Today
   *  marker — separated from `anchorStr` so jumping back doesn't
   *  also un-mark today. */
  todayStr: string;
  /** User's TZ offset in minutes west of UTC */
  tzOffsetMin: number;
  /** Viewer's own user_id — used by week-timesheet to separate own vs. other-member rows */
  currentUserId: string;
  weekEntries: TimeEntry[];
  dayEntries: TimeEntry[];
  /** Time entries inside the Log view's bounded window. Empty when
   *  the active view isn't `log` (page.tsx skips the fetch). */
  logEntries: TimeEntry[];
  logWindowDays: number;
  logDefaultWindowDays: number;
  logMaxWindowDays: number;
  running: TimeEntry | null;
  /** ALL projects (parents AND leaves). Used for both entry-creation
   *  pickers and the rendering map for existing entries. The earlier
   *  "leaf-only" rule was dropped 2026-05-06 — see the doc on
   *  /time-entries/page.tsx for the rationale. */
  projects: ProjectOption[];
  /** Project list for the toolbar's filter picker — same shape as
   *  `projects` but pre-projected to the picker's needs (just id,
   *  name, parent_project_id, customer_name, is_internal). */
  filterPickerProjects: ProjectFilterOption[];
  /** Selected project id from `?project=` (or null when the filter
   *  is off). The server has already resolved this to an `.in()` on
   *  the entry queries — this prop just drives the picker UI. */
  selectedProjectId: string | null;
  recentProjects: ProjectOption[];
  categories: CategoryOption[];
  templates: TimeTemplate[];
  /** Number of soft-deleted entries — renders a Trash link when > 0. */
  trashCount: number;
  memberOptions: MemberOption[];
  memberSelection: MemberSelection;
  /** Pre-formatted "Locked through" string (per-team when multi-
   *  team, single date otherwise). Null when no locks exist for
   *  the visible teams. */
  lockSummary: string | null;
}

export function TimeHome({
  teams,
  selectedTeamId,
  view,
  billableOnly,
  dayStr,
  weekStartStr,
  anchorStr,
  todayStr,
  tzOffsetMin,
  currentUserId,
  weekEntries,
  dayEntries,
  logEntries,
  logWindowDays,
  logDefaultWindowDays,
  logMaxWindowDays,
  running,
  projects,
  filterPickerProjects,
  selectedProjectId,
  recentProjects,
  categories,
  templates,
  trashCount,
  memberOptions,
  memberSelection,
  lockSummary,
}: TimeHomeProps): React.JSX.Element {
  const t = useTranslations("time");

  // Totals for the currently-visible data. Log view sums across the
  // bounded window so the masthead reflects "what you're looking at"
  // (the design doc calls for this-ISO-week always; we'll narrow to
  // that once the Log defaults stabilize and the masthead gets a
  // dedicated "range total" caption — preview keeps it simple).
  const visibleEntries =
    view === "day"
      ? dayEntries
      : view === "log"
        ? logEntries
        : weekEntries;
  const totalMin = sumDurationMin(visibleEntries);
  const billableMin = sumBillableMin(visibleEntries);
  const nonBillableMin = totalMin - billableMin;

  return (
    <div className="space-y-4">
      {/* Row 1 — page header. Title sits left; the previously-empty
          space alongside the H1 carries the canonical week total +
          billable breakdown so the user sees their hours at a glance
          without an extra row of vertical real estate. View toggle +
          trash link sit right.

          The total is sized as a sibling of the page title rather
          than a separate hero block — same weight, same baseline, so
          the eye treats them as one masthead. */}
      <div className="flex items-baseline gap-4 flex-wrap">
        <div className="flex items-baseline gap-3">
          <Clock size={24} className="text-accent self-center" />
          <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        </div>
        {/* Total + billable breakdown sit as a stacked masthead block:
            the canonical hours number shares the H1 baseline, and the
            billable/non-billable caption hangs underneath it as a
            secondary line. Putting the caption on the same baseline
            as the hero number reads as misaligned (caption type sitting
            on a page-title baseline always feels off), so it's stacked
            instead. */}
        <div className="flex flex-col min-w-0">
          <span className="font-mono text-page-title font-bold text-content tabular-nums">
            {formatDurationHMZero(totalMin)}
          </span>
          <span className="text-caption text-content-muted font-mono tabular-nums truncate">
            {t("totalsSummary", {
              billable: formatDurationHM(billableMin),
              nonBillable: formatDurationHM(nonBillableMin),
            })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 self-center">
          {trashCount > 0 && (
            <Link
              href="/time-entries/trash"
              className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-2.5 py-1 text-caption text-content-muted hover:text-content hover:bg-hover transition-colors"
            >
              <Trash2 size={12} />
              {t("trashLink", { count: trashCount })}
            </Link>
          )}
          <ViewToggle view={view} />
        </div>
      </div>

      {/* Row 2 — toolbar. Filters left, actions right. Sits just
          above the table so the controls that affect the table are
          close to it.

          The entry-creation pair (Start timer / Add past entry) is
          here too so the user doesn't need to scan three separate
          rows to find the buttons. When either form expands, the
          expansion rendered by the component appears in-place and
          flex-wraps onto its own line — the toolbar reflows
          gracefully without pushing the table around. */}
      <div className="flex items-start gap-2 flex-wrap">
        <TeamFilter teams={teams} selectedTeamId={selectedTeamId} />
        <MemberFilter
          members={memberOptions}
          selection={
            memberSelection === "none"
              ? []
              : memberSelection === "me" ||
                  memberSelection === "all"
                ? memberSelection
                : memberSelection
          }
        />
        <ProjectFilter
          projects={filterPickerProjects}
          selectedId={selectedProjectId}
        />
        <BillableFilter active={billableOnly} />
        <div className="ml-auto flex items-start gap-2 flex-wrap">
          <RunningTimerCard
            running={running}
            projects={projects}
            recentProjects={recentProjects}
            teams={teams}
            defaultTeamId={selectedTeamId ?? undefined}
            categories={categories}
            templates={templates}
            tzOffsetMin={tzOffsetMin}
          />
          <NewTimeEntryForm
            projects={projects}
            teams={teams}
            defaultTeamId={selectedTeamId ?? undefined}
            categories={categories}
            tzOffsetMin={tzOffsetMin}
          />
          <ExportButton />
        </div>
      </div>

      {lockSummary && (
        <div
          className="rounded-md border border-edge bg-surface-inset px-3 py-2 text-caption text-content-secondary"
          role="status"
        >
          <span className="font-semibold text-content">
            {t("lockedThrough")}
          </span>{" "}
          {lockSummary}
        </div>
      )}

      {view === "log" ? (
        <LogView
          anchorStr={anchorStr}
          todayStr={todayStr}
          windowDays={logWindowDays}
          defaultWindowDays={logDefaultWindowDays}
          maxWindowDays={logMaxWindowDays}
          tzOffsetMin={tzOffsetMin}
          entries={logEntries}
          projects={projects}
          categories={categories}
          viewerUserId={currentUserId}
        />
      ) : view === "day" ? (
        <DayView
          dayStr={dayStr}
          weekStartStr={weekStartStr}
          tzOffsetMin={tzOffsetMin}
          weekEntries={weekEntries}
          dayEntries={dayEntries}
          projects={projects}
          categories={categories}
          viewerUserId={currentUserId}
        />
      ) : (
        <WeekTimesheet
          weekStartStr={weekStartStr}
          tzOffsetMin={tzOffsetMin}
          entries={weekEntries}
          projects={projects}
          categories={categories}
          defaultTeamId={selectedTeamId ?? undefined}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}
