"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import type { OrgListItem } from "@/lib/org-context";
import {
  formatDurationShort,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import { RunningTimerCard } from "./running-timer-card";
import { WeekNav } from "./week-nav";
import { WeekGrid } from "./week-grid";
import { TodayPanel } from "./today-panel";
import { NewTimeEntryForm } from "./new-time-entry-form";
import type { ProjectOption, TimeEntry } from "./types";

interface TimeHomeProps {
  orgs: OrgListItem[];
  selectedOrgId: string | null;
  weekStartIso: string;
  weekEntries: TimeEntry[];
  todayEntries: TimeEntry[];
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
}

export function TimeHome({
  orgs,
  selectedOrgId,
  weekStartIso,
  weekEntries,
  todayEntries,
  running,
  projects,
  recentProjects,
}: TimeHomeProps): React.JSX.Element {
  const t = useTranslations("time");
  const weekStart = new Date(weekStartIso);

  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedEntryId((current) => (current === id ? null : id));
  }, []);

  const totalMin = sumDurationMin(weekEntries);
  const billableMin = sumBillableMin(weekEntries);
  const nonBillableMin = totalMin - billableMin;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Clock size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId} />
      </div>

      <RunningTimerCard
        running={running}
        projects={projects}
        recentProjects={recentProjects}
        orgs={orgs}
        defaultOrgId={selectedOrgId ?? undefined}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-content-secondary">
          {t("week.totals", {
            total: formatDurationShort(totalMin),
            billable: formatDurationShort(billableMin),
            nonBillable: formatDurationShort(nonBillableMin),
          })}
        </p>
        <WeekNav weekStart={weekStart} />
      </div>

      <WeekGrid
        weekStart={weekStart}
        entries={weekEntries}
        projects={projects}
        expandedEntryId={expandedEntryId}
        onToggleExpand={toggleExpanded}
      />

      <TodayPanel
        entries={todayEntries}
        projects={projects}
        expandedEntryId={expandedEntryId}
        onToggleExpand={toggleExpanded}
      />

      <NewTimeEntryForm
        projects={projects}
        orgs={orgs}
        defaultOrgId={selectedOrgId ?? undefined}
      />
    </div>
  );
}
