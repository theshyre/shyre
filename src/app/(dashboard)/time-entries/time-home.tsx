"use client";

import { useMemo } from "react";
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
  dayIso: string;
  weekStartIso: string;
  weekEndIso: string;
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
  dayIso,
  weekStartIso,
  weekEndIso,
  weekEntries,
  dayEntries,
  running,
  projects,
  recentProjects,
  categories,
  templates,
}: TimeHomeProps): React.JSX.Element {
  const t = useTranslations("time");
  const day = useMemo(() => new Date(dayIso), [dayIso]);
  const weekStart = useMemo(() => new Date(weekStartIso), [weekStartIso]);

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
          day={day}
          weekStart={weekStart}
          weekEntries={weekEntries}
          dayEntries={dayEntries}
          projects={projects}
          categories={categories}
        />
      ) : (
        <WeekTimesheet
          weekStart={weekStart}
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
      />
    </div>
  );
}
