"use client";

import { groupEntriesByDay } from "@/lib/time/week";
import { DayColumn } from "./day-column";
import type { ProjectOption, TimeEntry } from "./types";

interface Props {
  weekStart: Date;
  entries: TimeEntry[];
  projects: ProjectOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
}

export function WeekGrid({
  weekStart,
  entries,
  projects,
  expandedEntryId,
  onToggleExpand,
}: Props): React.JSX.Element {
  const days = groupEntriesByDay(entries, weekStart);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((dayEntries, idx) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + idx);
        return (
          <DayColumn
            key={idx}
            date={date}
            entries={dayEntries}
            projects={projects}
            expandedEntryId={expandedEntryId}
            onToggleExpand={onToggleExpand}
          />
        );
      })}
    </div>
  );
}
