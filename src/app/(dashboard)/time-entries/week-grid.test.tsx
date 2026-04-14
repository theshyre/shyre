import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  duplicateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  updateTimeEntryAction: vi.fn(),
}));

import { WeekGrid } from "./week-grid";
import type { TimeEntry } from "./types";

const project = { id: "p1", name: "Alpha", github_repo: null };

function makeEntry(id: string, date: Date): TimeEntry {
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `e-${id}`,
    start_time: date.toISOString(),
    end_time: new Date(date.getTime() + 3600_000).toISOString(),
    duration_min: 60,
    billable: true,
    github_issue: null,
    projects: project,
  };
}

describe("WeekGrid", () => {
  const weekStart = new Date(2026, 3, 13); // Mon

  it("renders 7 day columns", () => {
    renderWithIntl(
      <WeekGrid
        weekStart={weekStart}
        entries={[]}
        projects={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    // Mon..Sun → day numbers 13..19
    for (const day of [13, 14, 15, 16, 17, 18, 19]) {
      expect(screen.getByText(String(day))).toBeInTheDocument();
    }
  });

  it("places entries in the correct day column", () => {
    const entries = [
      makeEntry("mon", new Date(2026, 3, 13, 10)),
      makeEntry("wed", new Date(2026, 3, 15, 14)),
    ];
    renderWithIntl(
      <WeekGrid
        weekStart={weekStart}
        entries={entries}
        projects={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("e-mon")).toBeInTheDocument();
    expect(screen.getByText("e-wed")).toBeInTheDocument();
  });
});
