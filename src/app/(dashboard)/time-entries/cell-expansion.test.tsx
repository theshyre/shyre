import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { updateMock, createMock, deleteMock } = vi.hoisted(() => ({
  updateMock: vi.fn(async () => undefined),
  createMock: vi.fn(async () => undefined),
  deleteMock: vi.fn(async () => undefined),
}));

vi.mock("./actions", () => ({
  updateTimeEntryAction: updateMock,
  createTimeEntryAction: createMock,
  deleteTimeEntryAction: deleteMock,
}));

// TicketField pulls in TicketChip → server-only ticket actions; mock
// to a stub input so the test stays unit-scoped.
vi.mock("@/components/TicketField", () => ({
  TicketField: () => <input data-testid="ticket-field" name="ticket_ref" />,
  ticketFieldVisible: () => true,
}));

import { CellExpansion } from "./cell-expansion";
import type { ProjectOption, TimeEntry } from "./types";

const project: ProjectOption = {
  id: "p1",
  name: "Alpha",
  github_repo: null,
  jira_project_key: "AE",
  team_id: "o1",
  category_set_id: null,
  require_timestamps: false,
};

function makeEntry(id: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: `desc-${id}`,
    start_time: "2026-05-05T09:00:00Z",
    end_time: "2026-05-05T10:00:00Z",
    duration_min: 60,
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
    projects: null,
    author: null,
    ...overrides,
  };
}

describe("CellExpansion", () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
    deleteMock.mockClear();
  });

  it("renders one editable row per entry", () => {
    renderWithIntl(
      <CellExpansion
        entries={[makeEntry("e1"), makeEntry("e2")]}
        project={project}
        categoryId={null}
        dayDateStr="2026-05-05"
        dayDateLong="Tuesday, May 5"
        totalMinutes={120}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByDisplayValue(/desc-e/)).toHaveLength(2);
  });

  it("hides the entry list and auto-opens the add form when no entries", () => {
    renderWithIntl(
      <CellExpansion
        entries={[]}
        project={project}
        categoryId={null}
        dayDateStr="2026-05-05"
        dayDateLong="Tuesday, May 5"
        totalMinutes={0}
        onClose={() => {}}
      />,
    );
    // Description input from the add form should be auto-rendered.
    expect(screen.getByPlaceholderText(/work/i)).toBeInTheDocument();
  });

  it("opens the add form when '+ Add another entry' is clicked", () => {
    renderWithIntl(
      <CellExpansion
        entries={[makeEntry("e1")]}
        project={project}
        categoryId={null}
        dayDateStr="2026-05-05"
        dayDateLong="Tuesday, May 5"
        totalMinutes={60}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByPlaceholderText(/work/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add another/i }));
    expect(screen.getByPlaceholderText(/work/i)).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    renderWithIntl(
      <CellExpansion
        entries={[makeEntry("e1")]}
        project={project}
        categoryId={null}
        dayDateStr="2026-05-05"
        dayDateLong="Tuesday, May 5"
        totalMinutes={60}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a read-only summary for invoiced entries (no edit form)", () => {
    renderWithIntl(
      <CellExpansion
        entries={[
          makeEntry("e1", {
            invoiced: true,
            invoice_id: "inv-1",
            linked_ticket_key: "AE-640",
          }),
        ]}
        project={project}
        categoryId={null}
        dayDateStr="2026-05-05"
        dayDateLong="Tuesday, May 5"
        totalMinutes={60}
        onClose={() => {}}
      />,
    );
    // Save button should NOT exist for a locked entry.
    expect(
      screen.queryByRole("button", { name: /^save$/i }),
    ).not.toBeInTheDocument();
    // Open-day-view link does exist.
    expect(
      screen.getByRole("link", { name: /day view/i }),
    ).toBeInTheDocument();
  });
});
