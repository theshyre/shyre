import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { upsertCellMock, deleteMock } = vi.hoisted(() => ({
  upsertCellMock: vi.fn(async (_fd: FormData) => {}),
  deleteMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  upsertTimesheetCellAction: upsertCellMock,
  deleteTimeEntryAction: deleteMock,
}));

import { WeekTimesheet } from "./week-timesheet";
import type { ProjectOption, TimeEntry } from "./types";

const project: ProjectOption = {
  id: "p1",
  name: "Alpha",
  github_repo: null,
  organization_id: "o1",
  category_set_id: null,
  require_timestamps: false,
};

function makeEntry(
  id: string,
  opts: { day: number; durationMin: number; projectId?: string; categoryId?: string | null },
): TimeEntry {
  const start = new Date(2026, 3, 13 + opts.day, 0, 0);
  const end = new Date(start.getTime() + opts.durationMin * 60 * 1000);
  return {
    id,
    organization_id: "o1",
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

const weekStart = new Date(2026, 3, 13); // Mon

describe("WeekTimesheet", () => {
  beforeEach(() => {
    upsertCellMock.mockClear();
    deleteMock.mockClear();
  });

  it("renders Mon..Sun headers with day numbers", () => {
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
        entries={[]}
        projects={[project]}
        categories={[]}
      />,
    );
    // Day numbers 13..19 visible
    for (const n of [13, 14, 15, 16, 17, 18, 19]) {
      expect(screen.getByText(String(n))).toBeInTheDocument();
    }
  });

  it("groups entries into project rows", () => {
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
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
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
        entries={[
          makeEntry("e1", { day: 0, durationMin: 60 }), // 1:00 Mon
          makeEntry("e2", { day: 1, durationMin: 90 }), // 1:30 Tue
        ]}
        projects={[project]}
        categories={[]}
      />,
    );
    // Daily totals row shows 1:00 and 1:30
    expect(screen.getAllByText("1:00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1:30").length).toBeGreaterThanOrEqual(1);
  });

  it("calls upsert when a cell is edited and blurred", async () => {
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
        entries={[makeEntry("e1", { day: 0, durationMin: 60 })]}
        projects={[project]}
        categories={[]}
      />,
    );
    // Find a duration cell input and change it
    const cells = screen.getAllByRole("textbox");
    const cell = cells[0]!;
    fireEvent.change(cell, { target: { value: "2:30" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(upsertCellMock).toHaveBeenCalled());
    const fd = upsertCellMock.mock.calls[0]?.[0];
    expect(fd?.get("project_id")).toBe("p1");
    expect(fd?.get("duration_min")).toBe("150");
  });

  it("does not fire upsert when cell value is unchanged", async () => {
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
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
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
        entries={[]}
        projects={[project]}
        categories={[]}
      />,
    );
    expect(screen.getByText(/no time logged/i)).toBeInTheDocument();
  });

  it("'Add row' reveals a project picker", () => {
    renderWithIntl(
      <WeekTimesheet
        weekStart={weekStart}
        entries={[]}
        projects={[project]}
        categories={[]}
        defaultOrgId="o1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
