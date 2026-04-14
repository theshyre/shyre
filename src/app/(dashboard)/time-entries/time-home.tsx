"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import type { OrgListItem } from "@/lib/org-context";
import {
  formatDurationHM,
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
import { EntryTable } from "./entry-table";
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

  const groups = useMemo(
    () =>
      groupEntries(intervalEntries, grouping, {
        projects: projects.map((p) => ({ id: p.id, name: p.name })),
        categories,
        uncategorizedLabel: t("groupBy.uncategorized"),
      }),
    [intervalEntries, grouping, projects, categories, t],
  );

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
          <GroupByPicker grouping={grouping} />
          <IntervalNav interval={interval} />
        </div>
      </div>

      <EntryTable
        groups={groups}
        projects={projects}
        categories={categories}
        expandedEntryId={expandedEntryId}
        onToggleExpand={toggleExpanded}
      />

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
