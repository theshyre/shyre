import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { updateMock, createMock, deleteMock, startMock, stopMock } = vi.hoisted(() => ({
  updateMock: vi.fn(async () => undefined),
  createMock: vi.fn(async () => undefined),
  deleteMock: vi.fn(async () => undefined),
  startMock: vi.fn(async () => undefined),
  stopMock: vi.fn(async () => undefined),
}));

vi.mock("./actions", () => ({
  updateTimeEntryAction: updateMock,
  createTimeEntryAction: createMock,
  deleteTimeEntryAction: deleteMock,
  startTimerAction: startMock,
  stopTimerAction: stopMock,
}));

vi.mock("@/components/TicketField", () => ({
  TicketField: () => <input data-testid="ticket-field" name="ticket_ref" />,
  ticketFieldVisible: () => true,
}));

import {
  AddEntryRow,
  EntryEditRow,
  EntrySummaryRow,
  flattenEntriesByDay,
  shouldAutoExpand,
} from "./week-entry-row";
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
    author: { user_id: "u1", display_name: "Marcus", avatar_url: null },
    ...overrides,
  };
}

function wrapInTable(content: React.ReactNode): React.JSX.Element {
  return (
    <table>
      <tbody>{content}</tbody>
    </table>
  );
}

describe("flattenEntriesByDay", () => {
  it("returns a flat list paired with the day index", () => {
    const e1 = makeEntry("e1", { start_time: "2026-05-04T09:00:00Z" });
    const e2 = makeEntry("e2", { start_time: "2026-05-05T09:00:00Z" });
    const e3 = makeEntry("e3", { start_time: "2026-05-05T11:00:00Z" });
    const flat = flattenEntriesByDay([[e1], [e2, e3], [], [], [], [], []]);
    expect(flat).toHaveLength(3);
    expect(flat[0]?.entry.id).toBe("e1");
    expect(flat[0]?.dayIndex).toBe(0);
    expect(flat[1]?.entry.id).toBe("e2");
    expect(flat[1]?.dayIndex).toBe(1);
    expect(flat[2]?.entry.id).toBe("e3");
    expect(flat[2]?.dayIndex).toBe(1);
  });

  it("sorts entries within the same day by start_time", () => {
    const a = makeEntry("a", { start_time: "2026-05-05T11:00:00Z" });
    const b = makeEntry("b", { start_time: "2026-05-05T09:00:00Z" });
    const flat = flattenEntriesByDay([[], [a, b], [], [], [], [], []]);
    expect(flat[0]?.entry.id).toBe("b"); // earlier start
    expect(flat[1]?.entry.id).toBe("a");
  });
});

describe("shouldAutoExpand", () => {
  it("returns true when any day has >1 entry", () => {
    expect(
      shouldAutoExpand([
        [],
        [makeEntry("a"), makeEntry("b")],
        [],
        [],
        [],
        [],
        [],
      ]),
    ).toBe(true);
  });
  it("returns false when every day has ≤1 entry", () => {
    expect(
      shouldAutoExpand([[makeEntry("a")], [makeEntry("b")], [], [], [], [], []]),
    ).toBe(false);
  });
  it("returns false on an empty grid", () => {
    expect(shouldAutoExpand([[], [], [], [], [], [], []])).toBe(false);
  });
});

describe("EntrySummaryRow", () => {
  beforeEach(() => {
    deleteMock.mockClear();
  });

  it("shows the ticket key + description in the leading column", () => {
    renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", {
            description: "AE-640 Fix login bug",
            linked_ticket_key: "AE-640",
            linked_ticket_provider: "jira",
          })}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    expect(screen.getByText("AE-640")).toBeInTheDocument();
    // Description appears twice: the visible truncated span and the
    // sr-only companion so screen readers always reach the full
    // text. Both are required by the WCAG 4.1.2 fix.
    expect(screen.getAllByText(/Fix login bug/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders a non-color signal next to the ticket chip (CLAUDE.md ≥2 channels)", () => {
    const { container } = renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", {
            description: "Fix login bug",
            linked_ticket_key: "AE-640",
            linked_ticket_provider: "jira",
            linked_ticket_url: "https://example.atlassian.net/browse/AE-640",
          })}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    // ExternalLink (or Link when no URL) is rendered as an svg
    // alongside the ticket chip. Color-only differentiation was
    // the pre-existing WCAG 1.4.1 violation the audit caught.
    const ticketLink = container.querySelector(
      'a[href="https://example.atlassian.net/browse/AE-640"]',
    );
    expect(ticketLink).not.toBeNull();
    expect(ticketLink?.querySelector("svg")).not.toBeNull();
  });

  it("exposes the full description to screen readers when truncated", () => {
    const longDescription =
      "A very long description that the visible span will truncate but screen readers must still receive in full";
    renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", { description: longDescription })}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    const matches = screen.getAllByText(longDescription);
    // sr-only companion present.
    expect(matches.some((el) => el.classList.contains("sr-only"))).toBe(true);
    // Visible truncating span is aria-hidden so SRs don't double up.
    expect(
      matches.some((el) => el.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
  });

  it("renders the duration in the entry's day column only", () => {
    const { container } = renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", { duration_min: 79 })}
          dayIndex={2}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Wednesday, May 6"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    // 79 min → 1:19
    expect(container).toHaveTextContent("1:19");
  });

  it("clicking the edit button calls onEditToggle", () => {
    const onEditToggle = vi.fn();
    renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1")}
          dayIndex={1}
          editing={false}
          onEditToggle={onEditToggle}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /edit entry/i }));
    expect(onEditToggle).toHaveBeenCalled();
  });

  it("Play button calls startTimerAction with the entry's id", async () => {
    startMock.mockClear();
    renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", { linked_ticket_key: "AE-640" })}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /resume timer/i }));
    // Let the void async wrapper around handleSubmit settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(startMock).toHaveBeenCalled();
    const fd = (startMock.mock.calls as unknown as Array<[FormData]>)[0]?.[0];
    expect(fd?.get("resume_entry_id")).toBe("e1");
  });

  it("running entries show Stop instead of Play", () => {
    renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", { end_time: null })}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning
          liveElapsedMin={0}
        />,
      ),
    );
    expect(
      screen.getByRole("button", { name: /stop timer/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resume timer/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a lock affordance for invoiced entries instead of edit/delete", () => {
    renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", {
            invoiced: true,
            invoice_id: "inv-1",
          })}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    expect(
      screen.queryByRole("button", { name: /edit entry/i }),
    ).not.toBeInTheDocument();
    // Lock link to /invoices/inv-1
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/invoices/inv-1",
    );
  });
});

describe("EntryEditRow", () => {
  beforeEach(() => {
    updateMock.mockClear();
  });

  it("Save is disabled until the form is dirty", () => {
    renderWithIntl(
      wrapInTable(
        <EntryEditRow
          entry={makeEntry("e1")}
          project={project}
          projects={[project]}
          dayDateLong="Tuesday, May 5"
          onClose={() => {}}
        />,
      ),
    );
    const save = screen.getByRole("button", {
      name: /^save$/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("Escape closes the edit drawer", () => {
    const onClose = vi.fn();
    const { container } = renderWithIntl(
      wrapInTable(
        <EntryEditRow
          entry={makeEntry("e1")}
          project={project}
          projects={[project]}
          dayDateLong="Tuesday, May 5"
          onClose={onClose}
        />,
      ),
    );
    const form = container.querySelector("form")!;
    fireEvent.keyDown(form, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AddEntryRow", () => {
  beforeEach(() => {
    createMock.mockClear();
  });

  it("offers a day picker covering the visible week", () => {
    renderWithIntl(
      wrapInTable(
        <AddEntryRow
          project={project}
          categoryId={null}
          weekDays={[
            "2026-05-04",
            "2026-05-05",
            "2026-05-06",
            "2026-05-07",
            "2026-05-08",
            "2026-05-09",
            "2026-05-10",
          ]}
          defaultDayDateStr="2026-05-05"
          onClose={() => {}}
        />,
      ),
    );
    const select = screen.getByLabelText(/day/i) as HTMLSelectElement;
    expect(select.value).toBe("2026-05-05");
    expect(select.options).toHaveLength(7);
  });

  it("Add button starts disabled until form is dirty", () => {
    renderWithIntl(
      wrapInTable(
        <AddEntryRow
          project={project}
          categoryId={null}
          weekDays={["2026-05-05"]}
          defaultDayDateStr="2026-05-05"
          onClose={() => {}}
        />,
      ),
    );
    const add = screen.getAllByRole("button", {
      name: /add entry/i,
    })[0] as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });
});
