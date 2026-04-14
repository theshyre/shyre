import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  duplicateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  updateTimeEntryAction: vi.fn(),
}));

import { TodayPanel } from "./today-panel";
import type { TimeEntry } from "./types";

const project = { id: "p1", name: "Alpha", github_repo: null };

function makeEntry(id: string, minutes: number): TimeEntry {
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `entry-${id}`,
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + minutes * 60_000).toISOString(),
    duration_min: minutes,
    billable: true,
    github_issue: null,
    projects: project,
  };
}

describe("TodayPanel", () => {
  it("renders empty state when no entries", () => {
    renderWithIntl(
      <TodayPanel
        entries={[]}
        projects={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText(/no entries today/i)).toBeInTheDocument();
  });

  it("renders entries and their total", () => {
    const entries = [makeEntry("a", 30), makeEntry("b", 45)];
    renderWithIntl(
      <TodayPanel
        entries={entries}
        projects={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("entry-a")).toBeInTheDocument();
    expect(screen.getByText("entry-b")).toBeInTheDocument();
    // 75 min total → 1h 15m
    expect(screen.getByText(/1h 15m/)).toBeInTheDocument();
  });

  it("renders the Today title", () => {
    renderWithIntl(
      <TodayPanel
        entries={[]}
        projects={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: /today/i })).toBeInTheDocument();
  });
});
