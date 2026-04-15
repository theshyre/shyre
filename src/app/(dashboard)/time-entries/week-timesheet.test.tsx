import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { upsertCellMock, deleteMock, restoreBatchMock } = vi.hoisted(() => ({
  upsertCellMock: vi.fn(async (_fd: FormData) => {}),
  deleteMock: vi.fn(async (_fd: FormData) => {}),
  restoreBatchMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  upsertTimesheetCellAction: upsertCellMock,
  deleteTimeEntryAction: deleteMock,
  restoreTimeEntriesAction: restoreBatchMock,
}));

import { WeekTimesheet } from "./week-timesheet";
import { ToastProvider } from "@/components/Toast";
import type { ProjectOption, TimeEntry } from "./types";

function renderTimesheet(ui: React.ReactElement): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

const project: ProjectOption = {
  id: "p1",
  name: "Alpha",
  github_repo: null,
  team_id: "o1",
  category_set_id: null,
  require_timestamps: false,
};

function makeEntry(
  id: string,
  opts: { day: number; durationMin: number; projectId?: string; categoryId?: string | null },
): TimeEntry {
  // Use UTC midnight so the local-date conversion with tzOffsetMin=0 returns
  // a predictable calendar day.
  const start = new Date(Date.UTC(2026, 3, 13 + opts.day, 0, 0));
  const end = new Date(start.getTime() + opts.durationMin * 60 * 1000);
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: opts.projectId ?? "p1",
    description: null,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: opts.durationMin,
    billable: true,
    github_issue: null,
    category_id: opts.categoryId ?? null,
    projects: { id: "p1", name: "Alpha", github_repo: null },
  };
}

const weekStartStr = "2026-04-13";
const tzOffsetMin = 0;

describe("WeekTimesheet", () => {
  beforeEach(() => {
    upsertCellMock.mockClear();
    deleteMock.mockClear();
    restoreBatchMock.mockClear();
  });

  it("renders Mon..Sun headers with day numbers", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[]}
        projects={[project]}
        categories={[]}
      />,
    );
    for (const n of [13, 14, 15, 16, 17, 18, 19]) {
      expect(screen.getByText(String(n))).toBeInTheDocument();
    }
  });

  it("groups entries into project rows", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[
          makeEntry("e1", { day: 0, durationMin: 60 }),
          makeEntry("e2", { day: 2, durationMin: 90 }),
        ]}
        projects={[project]}
        categories={[]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("sums daily totals in the footer", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[
          makeEntry("e1", { day: 0, durationMin: 60 }), // 1:00 Mon
          makeEntry("e2", { day: 1, durationMin: 90 }), // 1:30 Tue
        ]}
        projects={[project]}
        categories={[]}
      />,
    );
    expect(screen.getAllByText("1:00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1:30").length).toBeGreaterThanOrEqual(1);
  });

  it("calls upsert when a cell is edited and blurred", async () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("e1", { day: 0, durationMin: 60 })]}
        projects={[project]}
        categories={[]}
      />,
    );
    const cells = screen.getAllByRole("textbox");
    const cell = cells[0]!;
    fireEvent.change(cell, { target: { value: "2:30" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(upsertCellMock).toHaveBeenCalled());
    const fd = upsertCellMock.mock.calls[0]?.[0];
    expect(fd?.get("project_id")).toBe("p1");
    expect(fd?.get("duration_min")).toBe("150");
    expect(fd?.get("tz_offset_min")).toBe("0");
  });

  it("does not fire upsert when cell value is unchanged", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("e1", { day: 0, durationMin: 60 })]}
        projects={[project]}
        categories={[]}
      />,
    );
    const cells = screen.getAllByRole("textbox");
    const cell = cells[0]!;
    fireEvent.focus(cell);
    fireEvent.blur(cell);
    expect(upsertCellMock).not.toHaveBeenCalled();
  });

  it("shows empty state when no rows", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[]}
        projects={[project]}
        categories={[]}
      />,
    );
    expect(screen.getByText(/no time logged/i)).toBeInTheDocument();
  });

  it("delete row → soft-deletes entries and pushes an Undo toast that restores them", async () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[
          makeEntry("e1", { day: 0, durationMin: 60 }),
          makeEntry("e2", { day: 1, durationMin: 90 }),
        ]}
        projects={[project]}
        categories={[]}
      />,
    );
    // Open row confirm + click Confirm
    fireEvent.click(screen.getByRole("button", { name: /delete row/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(2));
    // Undo toast is present
    const undo = await screen.findByRole("button", { name: /undo/i });
    expect(undo).toBeInTheDocument();
    // Clicking Undo calls the restore-batch action with both ids
    fireEvent.click(undo);
    await waitFor(() => expect(restoreBatchMock).toHaveBeenCalled());
    const fd = restoreBatchMock.mock.calls[0]?.[0];
    expect(fd?.getAll("id")).toEqual(["e1", "e2"]);
  });

  it("'Add row' reveals a project picker", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[]}
        projects={[project]}
        categories={[]}
        defaultTeamId="o1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
