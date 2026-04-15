import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  updateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  duplicateTimeEntryAction: vi.fn(),
}));

import { EntryTable } from "./entry-table";
import type { EntryGroup } from "@/lib/time/grouping";
import type { TimeEntry } from "./types";

function makeEntry(id: string, opts?: {
  description?: string;
  start?: Date;
  durationMin?: number;
  billable?: boolean;
  categoryId?: string | null;
  projectName?: string;
}): TimeEntry {
  const start = opts?.start ?? new Date(2026, 3, 13, 10);
  const dur = opts?.durationMin ?? 60;
  const end = new Date(start.getTime() + dur * 60 * 1000);
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: opts?.description ?? `entry ${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: dur,
    billable: opts?.billable ?? true,
    github_issue: null,
    category_id: opts?.categoryId ?? null,
    projects: { id: "p1", name: opts?.projectName ?? "Alpha", github_repo: null },
  };
}

function group(
  id: string,
  label: string,
  entries: TimeEntry[],
  extras: Partial<EntryGroup<TimeEntry>> = {},
): EntryGroup<TimeEntry> {
  return {
    id,
    label,
    entries,
    totalMin: entries.reduce((s, e) => s + (e.duration_min ?? 0), 0),
    billableMin: entries
      .filter((e) => e.billable)
      .reduce((s, e) => s + (e.duration_min ?? 0), 0),
    ...extras,
  };
}

describe("EntryTable", () => {
  it("renders table headers", () => {
    renderWithIntl(
      <EntryTable
        groups={[group("g1", "Today", [makeEntry("a")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /time/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /duration/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /project/i })).toBeInTheDocument();
  });

  it("renders empty state when all groups are empty", () => {
    renderWithIntl(
      <EntryTable
        groups={[]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText(/no time entries/i)).toBeInTheDocument();
  });

  it("renders group header with label and total in H:MM format", () => {
    renderWithIntl(
      <EntryTable
        groups={[
          group("g1", "Feature", [makeEntry("a", { durationMin: 195 })], {
            color: "#3b82f6",
          }),
        ]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("Feature")).toBeInTheDocument();
    // 195 min → 3:15 (shows in group header AND entry row)
    const durations = screen.getAllByText("3:15");
    expect(durations.length).toBeGreaterThanOrEqual(1);
  });

  it("hides group header when hideGroupHeaders=true", () => {
    renderWithIntl(
      <EntryTable
        groups={[group("g1", "Feature", [makeEntry("a")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    expect(screen.queryByText("Feature")).not.toBeInTheDocument();
  });

  it("shows H:MM duration for each entry", () => {
    renderWithIntl(
      <EntryTable
        groups={[group("g1", "T", [makeEntry("a", { durationMin: 45 })])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    expect(screen.getByText("0:45")).toBeInTheDocument();
  });

  it("clicking a row calls onToggleExpand with the entry id", () => {
    const onToggle = vi.fn();
    renderWithIntl(
      <EntryTable
        groups={[group("g1", "T", [makeEntry("a")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={onToggle}
        hideGroupHeaders
      />,
    );
    fireEvent.click(screen.getByText("entry a"));
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("renders the edit form spanning the table width when expanded", () => {
    renderWithIntl(
      <EntryTable
        groups={[
          group("g1", "T", [
            makeEntry("a", { start: new Date(2026, 3, 13, 10) }),
          ]),
        ]}
        projects={[]}
        categories={[]}
        expandedEntryId="a"
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeInTheDocument();
  });
});
