import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  duplicateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  updateTimeEntryAction: vi.fn(),
}));

import { EntryCard } from "./entry-card";
import type { TimeEntry } from "./types";

const project = { id: "p1", name: "Alpha", github_repo: null };
const completed: TimeEntry = {
  id: "e1",
  organization_id: "o1",
  user_id: "u1",
  project_id: "p1",
  description: "wrote tests",
  start_time: new Date(2026, 3, 13, 9).toISOString(),
  end_time: new Date(2026, 3, 13, 10).toISOString(),
  duration_min: 60,
  billable: true,
  github_issue: null,
  projects: project,
};
const running: TimeEntry = {
  ...completed,
  id: "e2",
  end_time: null,
  duration_min: null,
};

describe("EntryCard", () => {
  it("shows project name and description", () => {
    renderWithIntl(
      <EntryCard
        entry={completed}
        projects={[]}
        expanded={false}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("wrote tests")).toBeInTheDocument();
  });

  it("shows Running indicator for entry without end_time", () => {
    renderWithIntl(
      <EntryCard
        entry={running}
        projects={[]}
        expanded={false}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it("shows formatted duration for completed entry", () => {
    renderWithIntl(
      <EntryCard
        entry={completed}
        projects={[]}
        expanded={false}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("1h")).toBeInTheDocument();
  });

  it("calls onToggleExpand when the body is clicked", () => {
    const onToggle = vi.fn();
    renderWithIntl(
      <EntryCard
        entry={completed}
        projects={[]}
        expanded={false}
        onToggleExpand={onToggle}
      />,
    );
    // The card body is a button with aria-expanded
    const body = screen.getByRole("button", { expanded: false });
    fireEvent.click(body);
    expect(onToggle).toHaveBeenCalledWith("e1");
  });

  it("renders inline edit form when expanded", () => {
    renderWithIntl(
      <EntryCard
        entry={completed}
        projects={[{ ...project, organization_id: "o1" }]}
        expanded={true}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});
