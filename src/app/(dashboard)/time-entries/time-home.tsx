"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock, Trash2 } from "lucide-react";
import { TeamFilter } from "@/components/TeamFilter";
import { MemberFilter, type MemberOption } from "./member-filter";
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
  /** User's TZ offset in minutes west of UTC */
  tzOffsetMin: number;
  /** Viewer's own user_id — used by week-timesheet to separate own vs. other-member rows */
  currentUserId: string;
  weekEntries: TimeEntry[];
  dayEntries: TimeEntry[];
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
  categories: CategoryOption[];
  templates: TimeTemplate[];
  /** Number of soft-deleted entries — renders a Trash link when > 0. */
  trashCount: number;
  memberOptions: MemberOption[];
  memberSelection: MemberSelection;
}

export function TimeHome({
  teams,
  selectedTeamId,
  view,
  billableOnly,
  dayStr,
  weekStartStr,
  tzOffsetMin,
  currentUserId,
  weekEntries,
  dayEntries,
  running,
  projects,
  recentProjects,
  categories,
  templates,
  trashCount,
  memberOptions,
  memberSelection,
}: TimeHomeProps): React.JSX.Element {
  const t = useTranslations("time");

  // Totals for the currently-visible data (week for week view, day for day view)
  const visibleEntries = view === "day" ? dayEntries : weekEntries;
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
        <div className="flex items-center gap-3 self-center">
          <Clock size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        </div>
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="font-mono text-page-title font-bold text-content tabular-nums leading-none">
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

      {view === "day" ? (
        <DayView
          dayStr={dayStr}
          weekStartStr={weekStartStr}
          tzOffsetMin={tzOffsetMin}
          weekEntries={weekEntries}
          dayEntries={dayEntries}
          projects={projects}
          categories={categories}
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
