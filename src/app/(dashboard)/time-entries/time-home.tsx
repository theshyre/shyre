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
    <div className="space-y-6">
      {/* Row 1: page title + view toggle. Filters moved to row 2 so the
          H1 keeps a stable anchor as filters grow across pages. */}
      <div className="flex items-center gap-3 flex-wrap">
        <Clock size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        <div className="ml-auto flex items-center gap-2">
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

      {/* Row 2: all the filter pills in one place. Team + Member scope
          *which* entries are shown; Billable scopes *what kind*. Keeping
          them together so the user has one place to think about filters
          and a consistent pill style across the three. */}
      <div className="flex items-center gap-2 flex-wrap">
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
      </div>

      {/* Row 3: entry-creation cluster. Start timer (primary) + Add past
          entry (secondary) sit together — both create time entries, just
          via different UX paths. Flex-wrap lets the card grow when the
          timer is running or a form is expanded; the add-past button
          then wraps below gracefully. */}
      <div className="flex items-start gap-3 flex-wrap">
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
      </div>

      {/* Row 4: hero total on the left, export on the right. The hero
          number is the loudest glyph on the page — nothing on its
          baseline but the action that acts on it. */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-hero font-bold text-content tabular-nums leading-none">
            {formatDurationHM(totalMin)}
          </span>
          <span className="text-caption text-content-muted font-mono tabular-nums mt-1">
            {t("totalsSummary", {
              billable: formatDurationHM(billableMin),
              nonBillable: formatDurationHM(nonBillableMin),
            })}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
