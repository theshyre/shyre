import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  duplicateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  updateTimeEntryAction: vi.fn(),
}));

import { DayColumn } from "./day-column";
import type { TimeEntry } from "./types";

const project = { id: "p1", name: "Alpha", github_repo: null };

function makeEntry(id: string, startHour: number, durationMin = 60): TimeEntry {
  const start = new Date(2026, 3, 13, startHour);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `task-${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: durationMin,
    billable: true,
    github_issue: null,
    category_id: null,
    projects: project,
  };
}

describe("DayColumn", () => {
  const date = new Date(2026, 3, 13); // Mon Apr 13

  it("renders weekday, day number, and empty state", () => {
    renderWithIntl(
      <DayColumn
        date={date}
        entries={[]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText(/no entries/i)).toBeInTheDocument();
  });

  it("renders entry cards when entries present", () => {
    const entries = [makeEntry("a", 9), makeEntry("b", 14)];
    renderWithIntl(
      <DayColumn
        date={date}
        entries={entries}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("task-a")).toBeInTheDocument();
    expect(screen.getByText("task-b")).toBeInTheDocument();
    expect(screen.queryByText(/no entries/i)).not.toBeInTheDocument();
  });

  it("displays total duration of entries", () => {
    const entries = [makeEntry("a", 9, 30), makeEntry("b", 14, 60)];
    renderWithIntl(
      <DayColumn
        date={date}
        entries={entries}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    // 90 min total → 1h 30m
    expect(screen.getByText(/1h 30m/)).toBeInTheDocument();
  });

  it("highlights today", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { container } = renderWithIntl(
      <DayColumn
        date={today}
        entries={[]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    // Today gets the accent border class
    expect(container.querySelector(".border-accent\\/40")).toBeTruthy();
  });
});
