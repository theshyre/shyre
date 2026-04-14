"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import type { OrgListItem } from "@/lib/org-context";
import {
  formatDurationShort,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import type { IntervalKind, ResolvedInterval } from "@/lib/time/intervals";
import { groupEntries, type GroupingKind } from "@/lib/time/grouping";
import type { TimeTemplate } from "@/lib/templates/types";
import { RunningTimerCard } from "./running-timer-card";
import { IntervalNav } from "./interval-nav";
import { GroupByPicker } from "./group-by-picker";
import { BillableFilter } from "./billable-filter";
import { ExportButton } from "./export-button";
import { WeekGrid } from "./week-grid";
import { GroupedList } from "./grouped-list";
import { TodayPanel } from "./today-panel";
import { NewTimeEntryForm } from "./new-time-entry-form";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface TimeHomeProps {
  orgs: OrgListItem[];
  selectedOrgId: string | null;
  intervalKind: IntervalKind;
  intervalStartIso: string;
  intervalEndIso: string;
  grouping: GroupingKind;
  billableOnly: boolean;
  intervalEntries: TimeEntry[];
  todayEntries: TimeEntry[];
  running: TimeEntry | null;
  projects: ProjectOption[];
  recentProjects: ProjectOption[];
  categories: CategoryOption[];
  templates: TimeTemplate[];
}

export function TimeHome({
  orgs,
  selectedOrgId,
  intervalKind,
  intervalStartIso,
  intervalEndIso,
  grouping,
  billableOnly,
  intervalEntries,
  todayEntries,
  running,
  projects,
  recentProjects,
  categories,
  templates,
}: TimeHomeProps): React.JSX.Element {
  const t = useTranslations("time");

  const interval: ResolvedInterval = useMemo(
    () => ({
      kind: intervalKind,
      start: new Date(intervalStartIso),
      end: new Date(intervalEndIso),
    }),
    [intervalKind, intervalStartIso, intervalEndIso],
  );

  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedEntryId((current) => (current === id ? null : id));
  }, []);

  const totalMin = sumDurationMin(intervalEntries);
  const billableMin = sumBillableMin(intervalEntries);
  const nonBillableMin = totalMin - billableMin;

  // Decide renderer:
  //   interval=week + groupBy=day → existing 7-column grid
  //   otherwise → grouped list
  const useWeekGrid = intervalKind === "week" && grouping === "day";

  const groups = useMemo(() => {
    if (useWeekGrid) return [];
    return groupEntries(intervalEntries, grouping, {
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      categories,
      uncategorizedLabel: t("groupBy.uncategorized"),
    });
  }, [useWeekGrid, intervalEntries, grouping, projects, categories, t]);

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
        categories={categories}
        templates={templates}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-content-secondary">
            {t("week.totals", {
              total: formatDurationShort(totalMin),
              billable: formatDurationShort(billableMin),
              nonBillable: formatDurationShort(nonBillableMin),
            })}
          </p>
          <BillableFilter active={billableOnly} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton />
          <GroupByPicker grouping={grouping} />
          <IntervalNav interval={interval} />
        </div>
      </div>

      {useWeekGrid ? (
        <WeekGrid
          weekStart={interval.start}
          entries={intervalEntries}
          projects={projects}
          categories={categories}
          expandedEntryId={expandedEntryId}
          onToggleExpand={toggleExpanded}
        />
      ) : (
        <GroupedList
          groups={groups}
          projects={projects}
          categories={categories}
          expandedEntryId={expandedEntryId}
          onToggleExpand={toggleExpanded}
        />
      )}

      <TodayPanel
        entries={todayEntries}
        projects={projects}
        categories={categories}
        expandedEntryId={expandedEntryId}
        onToggleExpand={toggleExpanded}
      />

      <NewTimeEntryForm
        projects={projects}
        orgs={orgs}
        defaultOrgId={selectedOrgId ?? undefined}
        categories={categories}
      />
    </div>
  );
}
