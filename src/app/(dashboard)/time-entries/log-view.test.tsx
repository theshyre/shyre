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

import { LogView } from "./log-view";
import { ToastProvider } from "@/components/Toast";
import type { TimeEntry } from "./types";

function renderLog(ui: React.ReactElement): ReturnType<typeof renderWithIntl> {
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

const baseProps = {
  anchorStr: "2026-04-29",
  todayStr: "2026-04-29",
  windowDays: 14,
  defaultWindowDays: 14,
  maxWindowDays: 90,
  tzOffsetMin: 0,
  projects: [],
  categories: [],
  viewerUserId: "u1",
};

describe("LogView", () => {
  beforeEach(() => pushMock.mockClear());

  it("renders one band per day in the window, anchor first (today at top)", () => {
    renderLog(<LogView {...baseProps} entries={[]} />);
    // 14 day bands (sticky <h2>s) — assert by counting the day-band
    // section ids the component emits.
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBe(14);
    // Today's band is first.
    expect(headings[0]).toHaveAttribute("aria-current", "date");
  });

  it("buckets entries into their start-day band", () => {
    const entries = [
      // Today at 09:00 UTC.
      makeEntry("a", new Date(Date.UTC(2026, 3, 29, 9)), 60),
      // Yesterday at 14:00 UTC.
      makeEntry("b", new Date(Date.UTC(2026, 3, 28, 14)), 90),
    ];
    renderLog(<LogView {...baseProps} entries={entries} />);
    expect(screen.getByText("entry a")).toBeInTheDocument();
    expect(screen.getByText("entry b")).toBeInTheDocument();
  });

  it("renders the empty-day placeholder for bands with no entries", () => {
    renderLog(<LogView {...baseProps} entries={[]} />);
    // 14 bands × all empty.
    expect(screen.getAllByText(/no entries/i).length).toBe(14);
  });

  it("clicking 'Load earlier' pushes ?windowDays=21", () => {
    renderLog(<LogView {...baseProps} entries={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /load earlier 7 days/i }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]![0]).toContain("windowDays=21");
  });

  it("disables 'Load earlier' at the ceiling", () => {
    renderLog(
      <LogView {...baseProps} windowDays={90} entries={[]} />,
    );
    const btn = screen.getByRole("button", { name: /reached the preview window cap/i });
    expect(btn).toBeDisabled();
  });

  it("shows the reset link when expanded past the default window", () => {
    renderLog(
      <LogView {...baseProps} windowDays={28} entries={[]} />,
    );
    expect(screen.getByText(/reset to 14 days/i)).toBeInTheDocument();
  });

  it("hides the reset link when at the default window", () => {
    renderLog(<LogView {...baseProps} entries={[]} />);
    expect(screen.queryByText(/reset to 14 days/i)).not.toBeInTheDocument();
  });

  it("does not mark anchor as Today when anchor != today", () => {
    renderLog(
      <LogView
        {...baseProps}
        anchorStr="2026-04-15"
        todayStr="2026-04-29"
        entries={[]}
      />,
    );
    // No band should have aria-current=date because today isn't in
    // the visible window (29th is 14 days after the 15th and we're
    // anchored back at the 15th, so the visible range is Apr 02-15).
    const heads = screen.getAllByRole("heading", { level: 2 });
    for (const h of heads) {
      expect(h).not.toHaveAttribute("aria-current", "date");
    }
  });
});
