import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  updateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  duplicateTimeEntryAction: vi.fn(),
}));

import { GroupedList } from "./grouped-list";
import type { EntryGroup } from "@/lib/time/grouping";
import type { TimeEntry } from "./types";

function makeEntry(id: string, startHour: number, durationMin = 60): TimeEntry {
  const start = new Date(2026, 3, 13, startHour);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `e-${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: durationMin,
    billable: true,
    github_issue: null,
    category_id: null,
    projects: { id: "p1", name: "Alpha", github_repo: null },
  };
}

describe("GroupedList", () => {
  it("renders empty state when no groups", () => {
    renderWithIntl(
      <GroupedList
        groups={[]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText(/no time entries/i)).toBeInTheDocument();
  });

  it("renders each group header with label and total", () => {
    const groups: EntryGroup<TimeEntry>[] = [
      {
        id: "g1",
        label: "Feature",
        color: "#3b82f6",
        entries: [makeEntry("a", 9, 60), makeEntry("b", 10, 30)],
        totalMin: 90,
        billableMin: 90,
      },
    ];
    renderWithIntl(
      <GroupedList
        groups={groups}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Feature" })).toBeInTheDocument();
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("renders the group color dot when provided", () => {
    const groups: EntryGroup<TimeEntry>[] = [
      {
        id: "g1",
        label: "Feature",
        color: "#3b82f6",
        entries: [makeEntry("a", 9)],
        totalMin: 60,
        billableMin: 60,
      },
    ];
    const { container } = renderWithIntl(
      <GroupedList
        groups={groups}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    const dot = container.querySelector("span.h-2\\.5") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe("rgb(59, 130, 246)");
  });

  it("shows billable sub-total only when it differs from total", () => {
    const sameGroup: EntryGroup<TimeEntry>[] = [
      {
        id: "g1",
        label: "Feature",
        entries: [makeEntry("a", 9, 60)],
        totalMin: 60,
        billableMin: 60,
      },
    ];
    const { container, rerender } = renderWithIntl(
      <GroupedList
        groups={sameGroup}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(container.textContent).not.toMatch(/billable/i);

    const mixedGroup: EntryGroup<TimeEntry>[] = [
      {
        id: "g1",
        label: "Feature",
        entries: [makeEntry("a", 9, 60)],
        totalMin: 90,
        billableMin: 60,
      },
    ];
    rerender(
      <GroupedList
        groups={mixedGroup}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText(/billable/i)).toBeInTheDocument();
  });
});
