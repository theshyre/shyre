import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  startTimerAction: vi.fn(async () => ({ success: true })),
  stopTimerAction: vi.fn(async () => ({ success: true })),
  duplicateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  updateTimeEntryAction: vi.fn(),
}));

vi.mock("../templates/actions", () => ({
  startFromTemplateAction: vi.fn(async () => ({ success: true })),
}));

import { RunningTimerCard } from "./running-timer-card";
import type { TimeEntry } from "./types";

const project = {
  id: "p1",
  name: "Alpha",
  github_repo: null,
  team_id: "o1",
  category_set_id: null,
  require_timestamps: true,
};
const teams = [
  { id: "o1", name: "Org", slug: "org", role: "owner" as const },
];

describe("RunningTimerCard", () => {
  it("shows a 'Start timer' button by default (collapsed)", () => {
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        teams={teams}
        categories={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    // Project picker is NOT visible in collapsed state
    expect(
      document.querySelector('select[name="project_id"]'),
    ).toBeNull();
  });

  it("expands to show project picker when Start button clicked", () => {
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        teams={teams}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(
      document.querySelector('select[name="project_id"]'),
    ).toBeTruthy();
  });

  it("autofocuses the project select when expanded", () => {
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        teams={teams}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(document.querySelector('select[name="project_id"]')).toHaveFocus();
  });

  it("renders nothing when a timer is running — sidebar <Timer> owns that surface", () => {
    const running: TimeEntry = {
      id: "e1",
      team_id: "o1",
      user_id: "u1",
      project_id: "p1",
      description: "hacking",
      start_time: new Date(Date.now() - 3600_000).toISOString(),
      end_time: null,
      duration_min: null,
      billable: true,
      github_issue: null,
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
      category_id: null,
      projects: { id: "p1", name: "Alpha", github_repo: null },
      author: null,
    };
    const { container } = renderWithIntl(
      <RunningTimerCard
        running={running}
        projects={[project]}
        recentProjects={[]}
        teams={teams}
        categories={[]}
      />,
    );
    // The card used to render a green "RUNNING … Stop" banner in this
    // state. That duplicated the sidebar Timer and caused desync bugs;
    // the running surface now lives only in the sidebar.
    expect(container.textContent).not.toMatch(/alpha/i);
    expect(
      screen.queryByRole("button", { name: /stop/i }),
    ).not.toBeInTheDocument();
  });

  it("shows recent project chips after expanding", () => {
    const recent = [
      { id: "p1", name: "Alpha", github_repo: null, team_id: "o1", category_set_id: null, require_timestamps: true },
      { id: "p2", name: "Beta", github_repo: null, team_id: "o1", category_set_id: null, require_timestamps: true },
    ];
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={recent}
        teams={teams}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("hides org selector when only one org (after expanding)", () => {
    renderWithIntl(
      <RunningTimerCard
        running={null}
        projects={[project]}
        recentProjects={[]}
        teams={teams}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(
      screen.queryByRole("combobox", { name: /organization/i }),
    ).not.toBeInTheDocument();
  });
});
