import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  startTimerAction: vi.fn(async () => ({ success: true })),
  stopTimerAction: vi.fn(async () => ({ success: true })),
  duplicateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  updateTimeEntryAction: vi.fn(),
}));

import { RunningTimerCard } from "./running-timer-card";
import type { TimeEntry } from "./types";

const project = {
  id: "p1",
  name: "Alpha",
  github_repo: null,
  organization_id: "o1",
};
const orgs = [
  { id: "o1", name: "Org", slug: "org", role: "owner" as const },
];

describe("RunningTimerCard", () => {
  it("shows start form when no running timer", () => {
    const { container } = renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        orgs={orgs}
      />,
    );
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    expect(container.querySelector('select[name="project_id"]')).toBeTruthy();
  });

  it("autofocuses the project select", () => {
    const { container } = renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        orgs={orgs}
      />,
    );
    expect(container.querySelector('select[name="project_id"]')).toHaveFocus();
  });

  it("renders running state with project name and elapsed", () => {
    const running: TimeEntry = {
      id: "e1",
      organization_id: "o1",
      user_id: "u1",
      project_id: "p1",
      description: "hacking",
      start_time: new Date(Date.now() - 3600_000).toISOString(),
      end_time: null,
      duration_min: null,
      billable: true,
      github_issue: null,
      projects: { id: "p1", name: "Alpha", github_repo: null },
    };
    renderWithIntl(
      <RunningTimerCard
        running={running}
        projects={[project]}
        recentProjects={[]}
        orgs={orgs}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("hacking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    // Elapsed time is HH:MM:SS format
    expect(screen.getByText(/^\d\d:\d\d:\d\d$/)).toBeInTheDocument();
  });

  it("shows recent project chips when provided", () => {
    const recent = [
      { id: "p1", name: "Alpha", github_repo: null, organization_id: "o1" },
      { id: "p2", name: "Beta", github_repo: null, organization_id: "o1" },
    ];
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={recent}
        orgs={orgs}
      />,
    );
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("hides org selector when only one org", () => {
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        orgs={orgs}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /organization/i })).not.toBeInTheDocument();
  });
});
