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
}));

import { DayView } from "./day-view";
import type { TimeEntry } from "./types";

function makeEntry(id: string, start: Date, durationMin = 60): TimeEntry {
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `entry ${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: durationMin,
    billable: true,
    github_issue: null,
    category_id: null,
    projects: { id: "p1", name: "Alpha", github_repo: null },
  };
}

const weekStart = new Date(2026, 3, 13);

describe("DayView", () => {
  beforeEach(() => pushMock.mockClear());

  it("renders 7-day strip with daily totals + week total", () => {
    const weekEntries = [
      makeEntry("a", new Date(2026, 3, 13, 9), 60),
      makeEntry("b", new Date(2026, 3, 14, 10), 90),
    ];
    renderWithIntl(
      <DayView
        day={new Date(2026, 3, 14)}
        weekStart={weekStart}
        weekEntries={weekEntries}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    // Mon daily total = 1:00, Tue = 1:30 → week total 2:30
    expect(screen.getAllByText("1:00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1:30").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/week total/i)).toBeInTheDocument();
  });

  it("prev/next navigate to adjacent days", () => {
    renderWithIntl(
      <DayView
        day={new Date(2026, 3, 14)}
        weekStart={weekStart}
        weekEntries={[]}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /previous day/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("anchor=2026-04-13"));
    fireEvent.click(screen.getByRole("button", { name: /next day/i }));
    expect(pushMock).toHaveBeenLastCalledWith(
      expect.stringContaining("anchor=2026-04-15"),
    );
  });

  it("clicking a day in the strip navigates to that day", () => {
    renderWithIntl(
      <DayView
        day={new Date(2026, 3, 14)}
        weekStart={weekStart}
        weekEntries={[]}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    // Click on Friday (Apr 17)
    const friButtons = screen.getAllByRole("button");
    const fri = friButtons.find((b) => b.textContent?.includes("Fri"));
    expect(fri).toBeTruthy();
    fireEvent.click(fri!);
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("anchor=2026-04-17"));
  });

  it("renders the day's entries", () => {
    renderWithIntl(
      <DayView
        day={new Date(2026, 3, 14)}
        weekStart={weekStart}
        weekEntries={[]}
        dayEntries={[makeEntry("a", new Date(2026, 3, 14, 9))]}
        projects={[]}
        categories={[]}
      />,
    );
    expect(screen.getByText("entry a")).toBeInTheDocument();
  });

  it("labels today's date with 'Today:'", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mondayOfToday = new Date(today);
    mondayOfToday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    renderWithIntl(
      <DayView
        day={today}
        weekStart={mondayOfToday}
        weekEntries={[]}
        dayEntries={[]}
        projects={[]}
        categories={[]}
      />,
    );
    expect(screen.getByText(/today:/i)).toBeInTheDocument();
  });
});
