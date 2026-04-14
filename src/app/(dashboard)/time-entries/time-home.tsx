"use client";

import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import type { OrgListItem } from "@/lib/org-context";
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
  orgs: OrgListItem[];
  selectedOrgId: string | null;
  view: TimeView;
  billableOnly: boolean;
  /** Local date being viewed (YYYY-MM-DD in user's TZ) */
  dayStr: string;
  /** Local date of the Monday of the visible week (YYYY-MM-DD in user's TZ) */
  weekStartStr: string;
  /** User's TZ offset in minutes west of UTC */
  tzOffsetMin: number;
  weekEntries: TimeEntry[];
  dayEntries: TimeEntry[];
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
  categories: CategoryOption[];
  templates: TimeTemplate[];
}

export function TimeHome({
  orgs,
  selectedOrgId,
  view,
  billableOnly,
  dayStr,
  weekStartStr,
  tzOffsetMin,
  weekEntries,
  dayEntries,
  running,
  projects,
  recentProjects,
  categories,
  templates,
}: TimeHomeProps): React.JSX.Element {
  const t = useTranslations("time");

  // Totals for the currently-visible data (week for week view, day for day view)
  const visibleEntries = view === "day" ? dayEntries : weekEntries;
  const totalMin = sumDurationMin(visibleEntries);
  const billableMin = sumBillableMin(visibleEntries);
  const nonBillableMin = totalMin - billableMin;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Clock size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId} />
        <div className="ml-auto">
          <ViewToggle view={view} />
        </div>
      </div>

      <RunningTimerCard
        running={running}
        projects={projects}
        recentProjects={recentProjects}
        orgs={orgs}
        defaultOrgId={selectedOrgId ?? undefined}
        categories={categories}
        templates={templates}
        tzOffsetMin={tzOffsetMin}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-content tabular-nums">
              {formatDurationHM(totalMin)}
            </span>
            <span className="text-xs text-content-muted">
              {t("totalsSummary", {
                billable: formatDurationHM(billableMin),
                nonBillable: formatDurationHM(nonBillableMin),
              })}
            </span>
          </div>
          <BillableFilter active={billableOnly} />
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
          defaultOrgId={selectedOrgId ?? undefined}
        />
      )}

      <NewTimeEntryForm
        projects={projects}
        orgs={orgs}
        defaultOrgId={selectedOrgId ?? undefined}
        categories={categories}
        tzOffsetMin={tzOffsetMin}
      />
    </div>
  );
}
