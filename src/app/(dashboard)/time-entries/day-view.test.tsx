import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  updateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  duplicateTimeEntryAction: vi.fn(),
  startTimerAction: vi.fn(),
}));

import { DayView } from "./day-view";
import { ToastProvider } from "@/components/Toast";
import type { ProjectOption, TimeEntry } from "./types";

function renderDay(ui: React.ReactElement): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

function makeEntry(id: string, start: Date, durationMin = 60): TimeEntry {
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `entry ${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: durationMin,
    billable: true,
    github_issue: null,
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    category_id: null,
    projects: { id: "p1", name: "Alpha", github_repo: null },
    author: null,
  };
}

const weekStartStr = "2026-04-13";
const tzOffsetMin = 0;

describe("DayView", () => {
  beforeEach(() => pushMock.mockClear());

  it("renders 7-day strip with daily totals + week total", () => {
    const weekEntries = [
      makeEntry("a", new Date(Date.UTC(2026, 3, 13, 9)), 60),
      makeEntry("b", new Date(Date.UTC(2026, 3, 14, 10)), 90),
    ];
    renderDay(
      <DayView
        viewerUserId={null}
        dayStr="2026-04-14"
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        weekEntries={weekEntries}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    expect(screen.getAllByText("1:00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1:30").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/week total/i)).toBeInTheDocument();
  });

  it("prev navigates to the prior day", () => {
    renderDay(
      <DayView
        viewerUserId={null}
        dayStr="2026-04-14"
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        weekEntries={[]}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /previous day/i }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("anchor=2026-04-13"),
    );
  });

  it("next navigates to the following day", () => {
    renderDay(
      <DayView
        viewerUserId={null}
        dayStr="2026-04-14"
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        weekEntries={[]}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next day/i }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("anchor=2026-04-15"),
    );
  });

  it("clicking a day in the strip navigates to that day", () => {
    renderDay(
      <DayView
        viewerUserId={null}
        dayStr="2026-04-14"
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        weekEntries={[]}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    const friButtons = screen.getAllByRole("button");
    const fri = friButtons.find((b) => b.textContent?.includes("Fri"));
    expect(fri).toBeTruthy();
    fireEvent.click(fri!);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("anchor=2026-04-17"));
  });

  it("renders the day's entries", () => {
    renderDay(
      <DayView
        viewerUserId={null}
        dayStr="2026-04-14"
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        weekEntries={[]}
        dayEntries={[makeEntry("a", new Date(Date.UTC(2026, 3, 14, 9)))]}
        projects={[]}
        categories={[]}
      />,
    );
    expect(screen.getByText("entry a")).toBeInTheDocument();
  });

  // Day-view customer sub-grouping (parity with the week view, 2026-05-12).
  // Same visual language: each customer renders a <th scope="rowgroup">
  // sub-header above its rows, regardless of row count.
  it("groups the day's entries by customer with one sub-header per customer", () => {
    const projAcme: ProjectOption = {
      id: "p-acme",
      name: "Acme Project",
      github_repo: null,
      jira_project_key: null,
      team_id: "o1",
      category_set_id: null,
      require_timestamps: false,
      customers: { id: "cust-acme", name: "Acme Corp" },
    };
    const projBeta: ProjectOption = {
      id: "p-beta",
      name: "Beta Project",
      github_repo: null,
      jira_project_key: null,
      team_id: "o1",
      category_set_id: null,
      require_timestamps: false,
      customers: { id: "cust-beta", name: "Beta LLC" },
    };
    const e1: TimeEntry = {
      ...makeEntry("a", new Date(Date.UTC(2026, 3, 14, 9))),
      project_id: "p-acme",
      projects: { id: "p-acme", name: "Acme Project", github_repo: null },
    };
    const e2: TimeEntry = {
      ...makeEntry("b", new Date(Date.UTC(2026, 3, 14, 11))),
      project_id: "p-beta",
      projects: { id: "p-beta", name: "Beta Project", github_repo: null },
    };
    const { container } = renderDay(
      <DayView
        viewerUserId={null}
        dayStr="2026-04-14"
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        weekEntries={[]}
        dayEntries={[e1, e2]}
        projects={[projAcme, projBeta]}
        categories={[]}
      />,
    );
    const rowgroups = container.querySelectorAll("th[scope='rowgroup']");
    expect(rowgroups).toHaveLength(2);
    const labels = Array.from(rowgroups).map((el) => el.textContent ?? "");
    expect(labels.some((l) => l.includes("Acme Corp"))).toBe(true);
    expect(labels.some((l) => l.includes("Beta LLC"))).toBe(true);
  });
});
