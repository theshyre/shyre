import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { updateMock, createMock, deleteMock, startMock, stopMock, updateDurationMock } =
  vi.hoisted(() => ({
    updateMock: vi.fn(async () => undefined),
    createMock: vi.fn(async () => undefined),
    deleteMock: vi.fn(async () => undefined),
    startMock: vi.fn(async () => undefined),
    stopMock: vi.fn(async () => undefined),
    updateDurationMock: vi.fn(async (_fd: FormData) => undefined),
  }));

vi.mock("./actions", () => ({
  updateTimeEntryAction: updateMock,
  createTimeEntryAction: createMock,
  deleteTimeEntryAction: deleteMock,
  startTimerAction: startMock,
  stopTimerAction: stopMock,
  updateTimeEntryDurationAction: updateDurationMock,
}));

vi.mock("./ticket-field", () => ({
  TicketField: () => <input data-testid="ticket-field" name="ticket_ref" />,
  ticketFieldVisible: () => true,
}));

import {
  AddEntryRow,
  EntryEditRow,
  EntrySummaryRow,
  TitleLineRow,
  TitleLineDrawer,
  flattenEntriesByDay,
} from "./week-entry-row";
import { groupEntriesByTitle } from "./group-entries-by-title";
import type { ProjectOption, TimeEntry } from "./types";

const WEEK_DAYS_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Build a length-7 entriesByDay matrix from a day→entries map. */
function dayGrid(
  byDay: Partial<Record<number, TimeEntry[]>>,
): TimeEntry[][] {
  return Array.from({ length: 7 }, (_, d) => byDay[d] ?? []);
}

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
          categories={[]}
          onClose={() => {}}
        />,
      ),
    );
    const save = screen.getByRole("button", {
      name: /^save$/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("edit form has the category picker + an auto-growing description textarea", () => {
    const catProject: ProjectOption = { ...project, category_set_id: "cs1" };
    const { container } = renderWithIntl(
      wrapInTable(
        <EntryEditRow
          entry={makeEntry("e1")}
          project={catProject}
          projects={[catProject]}
          categories={[
            {
              id: "c1",
              category_set_id: "cs1",
              name: "Engineering",
              color: "#3b82f6",
              sort_order: 0,
            },
          ]}
          dayDateLong="Tuesday, May 5"
          onClose={() => {}}
        />,
      ),
    );
    // Category picker: a select[name=category_id] offering the set's option
    // (the week form was missing this entirely).
    expect(
      container.querySelector("select[name='category_id']"),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Engineering" }),
    ).toBeInTheDocument();
    // Description is a textarea now (auto-grow), not a single-line input.
    expect(
      container.querySelector("textarea[name='description']"),
    ).toBeTruthy();
    expect(container.querySelector("input[name='description']")).toBeNull();
  });

  it("project picker reflects the user's selection (regression: bug where pick reverted to original)", () => {
    const p2: ProjectOption = {
      id: "p2",
      name: "Beta",
      github_repo: null,
      jira_project_key: null,
      team_id: "o1",
      category_set_id: null,
      require_timestamps: false,
    };
    const { container } = renderWithIntl(
      wrapInTable(
        <EntryEditRow
          entry={makeEntry("e1")}
          project={project}
          projects={[project, p2]}
          dayDateLong="Tuesday, May 5"
          categories={[]}
          onClose={() => {}}
        />,
      ),
    );
    const select = container.querySelector<HTMLSelectElement>(
      'select[name="project_id"]',
    );
    expect(select).toBeTruthy();
    expect(select!.value).toBe("p1");
    fireEvent.change(select!, { target: { value: "p2" } });
    expect(select!.value).toBe("p2");
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
          categories={[]}
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

describe("TitleLineRow", () => {
  beforeEach(() => {
    updateDurationMock.mockClear();
  });

  const ticket = {
    linked_ticket_key: "AE-644",
    linked_ticket_provider: "jira" as const,
    linked_ticket_url: "https://x/AE-644",
    description: "cutover implementation",
  };

  /** A distinct-day merged line: AE-644 on Mon/Tue/Wed (1:00, 3:30, 1:30). */
  function distinctDayLine() {
    return groupEntriesByTitle(
      dayGrid({
        0: [makeEntry("e1", { ...ticket, duration_min: 60 })],
        1: [makeEntry("e2", { ...ticket, duration_min: 210 })],
        2: [makeEntry("e3", { ...ticket, duration_min: 90 })],
      }),
    )[0]!;
  }

  function renderLine(
    line = distinctDayLine(),
    props: Partial<React.ComponentProps<typeof TitleLineRow>> = {},
  ) {
    return renderWithIntl(
      wrapInTable(
        <TitleLineRow
          line={line}
          expanded={false}
          onToggle={() => {}}
          controlsId="title-0-0"
          dayDatesLong={WEEK_DAYS_LONG}
          runningStartIso={null}
          runningNowMs={0}
          {...props}
        />,
      ),
    );
  }

  it("folds same-title entries onto one line with per-day durations and a summed total", () => {
    const { container } = renderLine();
    expect(screen.getByText("AE-644")).toBeInTheDocument();
    // Per-day durations spread across the matrix — single-entry cells are
    // editable inputs, so the value lives in the input, not textContent.
    expect((screen.getByLabelText("Mon — 1:00") as HTMLInputElement).value).toBe(
      "1:00",
    );
    expect((screen.getByLabelText("Tue — 3:30") as HTMLInputElement).value).toBe(
      "3:30",
    );
    expect((screen.getByLabelText("Wed — 1:30") as HTMLInputElement).value).toBe(
      "1:30",
    );
    // Summed total (6:00) is plain text in the total column.
    expect(container).toHaveTextContent("6:00");
  });

  it("shows an entry-count badge of folded entries", () => {
    renderLine();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("edits a single-entry cell by entry id (never the cell upsert)", () => {
    renderLine();
    // The Tuesday cell holds exactly one entry (e2, 3:30) → editable.
    const input = screen.getByLabelText("Tue — 3:30") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4:00" } });
    fireEvent.blur(input);
    expect(updateDurationMock).toHaveBeenCalledTimes(1);
    const fdArg = updateDurationMock.mock.calls[0]![0];
    expect(fdArg.get("id")).toBe("e2");
    expect(fdArg.get("duration_min")).toBe("240");
  });

  it("renders a read-only sum as a button (not an input) for a same-day collision cell, and expands on click", () => {
    const line = groupEntriesByTitle(
      dayGrid({
        4: [
          makeEntry("c1", { description: "Testing framework", duration_min: 30 }),
          makeEntry("c2", { description: "Testing framework", duration_min: 45 }),
        ],
      }),
    )[0]!;
    const onToggle = vi.fn();
    renderLine(line, { onToggle });
    // The collision cell is a button, not a textbox — a summed cell has
    // no single edit target.
    const summed = screen.getByRole("button", {
      name: /total across 2 entries/i,
    });
    fireEvent.click(summed);
    expect(onToggle).toHaveBeenCalled();
    // And it shows the summed duration (0:75 → 1:15).
    expect(summed).toHaveTextContent("1:15");
  });

  it("leaves empty days read-only when no create handler is provided", () => {
    const { container } = renderLine();
    // Thursday..Sunday have no entries and no create affordance — they
    // render the muted `·` placeholder, never a DurationInput.
    const placeholders = container.querySelectorAll("td span[aria-hidden='true']");
    const dots = Array.from(placeholders).filter((el) => el.textContent === "·");
    expect(dots.length).toBeGreaterThan(0);
  });

  it("creates a same-title entry when an empty day is typed into", () => {
    const onCellCreate = vi.fn();
    renderLine(distinctDayLine(), { onCellCreate });
    // Thursday (index 3) is empty for the AE-644 line → an editable
    // input whose aria-label is the date with an empty duration.
    const input = screen.getByLabelText(/^Thu —/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0:45" } });
    fireEvent.blur(input);
    expect(onCellCreate).toHaveBeenCalledWith(3, 45);
  });

  it("clicking the line chevron toggles the per-entry disclosure", () => {
    const onToggle = vi.fn();
    renderLine(distinctDayLine(), { onToggle });
    fireEvent.click(
      screen.getByRole("button", { name: /on AE-644/i }),
    );
    expect(onToggle).toHaveBeenCalled();
  });

  it("distinguishes partial from full invoiced state without relying on color", () => {
    // Partial: one of two entries invoiced → an invoiced/total fraction
    // is the distinguishing channel (beyond the lock icon + warning color).
    const partial = groupEntriesByTitle(
      dayGrid({
        0: [
          makeEntry("p1", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-1",
          }),
        ],
        1: [makeEntry("p2", { description: "AE-9" })],
      }),
    )[0]!;
    const { unmount } = renderLine(partial);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // The indicator carries an accessible label even though it's icon-only.
    expect(
      screen.getByLabelText(/1 of 2 entries invoiced/i),
    ).toBeInTheDocument();
    unmount();

    // All invoiced: lock indicator labelled "Invoiced", and NO fraction.
    const all = groupEntriesByTitle(
      dayGrid({
        0: [
          makeEntry("a1", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-1",
          }),
        ],
        1: [
          makeEntry("a2", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-1",
          }),
        ],
      }),
    )[0]!;
    renderLine(all);
    expect(screen.queryByText("2/2")).toBeNull();
    expect(screen.getByLabelText("Invoiced")).toBeInTheDocument();
  });

  it("strips the leading ticket key from the merged line's description", () => {
    const line = groupEntriesByTitle(
      dayGrid({
        0: [
          makeEntry("a", {
            linked_ticket_key: "AE-644",
            linked_ticket_provider: "jira",
            description: "AE-644 Amplify Gen 2 cutover",
            duration_min: 60,
          }),
        ],
        1: [
          makeEntry("b", {
            linked_ticket_key: "AE-644",
            linked_ticket_provider: "jira",
            description: "AE-644 Amplify Gen 2 cutover",
            duration_min: 90,
          }),
        ],
      }),
    )[0]!;
    renderLine(line);
    // Chip shows the key once; the description no longer repeats it.
    expect(screen.getByText("AE-644")).toBeInTheDocument();
    expect(screen.getAllByText("Amplify Gen 2 cutover").length).toBeGreaterThan(0);
    expect(screen.queryByText(/AE-644 Amplify Gen 2 cutover/)).toBeNull();
  });
});

describe("TitleLineDrawer", () => {
  beforeEach(() => {
    deleteMock.mockClear();
  });

  const rows = [
    {
      entry: makeEntry("d1", {
        linked_ticket_key: "AE-644",
        description: "AE-644 cutover",
        duration_min: 60,
      }),
      dayIndex: 0,
    },
    {
      entry: makeEntry("d2", {
        linked_ticket_key: "AE-644",
        description: "AE-644 cutover",
        duration_min: 90,
      }),
      dayIndex: 1,
    },
  ];

  function renderDrawer(
    props: Partial<React.ComponentProps<typeof TitleLineDrawer>> = {},
  ) {
    return renderWithIntl(
      wrapInTable(
        <TitleLineDrawer
          rows={rows}
          controlsId="title-0-0"
          dayDatesLong={WEEK_DAYS_LONG}
          taskLabel="AE-644"
          runningStartIso={null}
          runningNowMs={0}
          editingEntryId={null}
          onEditToggle={() => {}}
          onClose={() => {}}
          {...props}
        />,
      ),
    );
  }

  it("shows date + duration per entry without repeating the identity", () => {
    renderDrawer();
    // Distinguisher = the day, shown as visible text.
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("1:00")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    // The ticket + description are NOT repeated per entry — the title
    // line above already carries them. No ticket chip in the drawer.
    expect(screen.queryByText("AE-644")).toBeNull();
    expect(screen.queryByText(/cutover/)).toBeNull();
  });

  it("gives each entry's actions a date-scoped accessible name", () => {
    renderDrawer();
    expect(
      screen.getByRole("button", { name: /edit the mon entry/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete the tue entry/i }),
    ).toBeInTheDocument();
  });

  it("is associated with its trigger via the controlsId on the row", () => {
    const { container } = renderDrawer({ controlsId: "title-7-2" });
    expect(container.querySelector("#title-7-2")).not.toBeNull();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a locked entry as an invoice link, not edit/delete", () => {
    renderDrawer({
      rows: [
        {
          entry: makeEntry("locked", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-99",
            duration_min: 60,
          }),
          dayIndex: 0,
        },
      ],
    });
    const link = screen.getByRole("link", { name: /invoiced/i });
    expect(link).toHaveAttribute("href", "/invoices/inv-99");
    // The "Invoiced" word is visible (not icon-only).
    expect(link).toHaveTextContent(/invoiced/i);
    expect(
      screen.queryByRole("button", { name: /delete the/i }),
    ).toBeNull();
  });

  it("shows the invoice number on a locked entry and links to it", () => {
    renderDrawer({
      rows: [
        {
          entry: makeEntry("locked", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-99",
            invoice_number: "1042",
            duration_min: 60,
          }),
          dayIndex: 0,
        },
      ],
    });
    const link = screen.getByRole("link", { name: /view invoice 1042/i });
    expect(link).toHaveAttribute("href", "/invoices/inv-99");
    expect(link).toHaveTextContent("1042");
  });
});

describe("agent attribution on week rows (SAL-051)", () => {
  it("EntrySummaryRow shows the Bot badge (compact: icon + sr-only text) for an agent-started entry", () => {
    const { container } = renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1", {
            started_by_kind: "agent",
            agent_label: "Claude Code",
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
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
    const badgeText = screen.getByText("via Claude Code");
    expect(badgeText.className).toContain("sr-only");
  });

  it("EntrySummaryRow shows no badge for a user-started entry", () => {
    const { container } = renderWithIntl(
      wrapInTable(
        <EntrySummaryRow
          entry={makeEntry("e1")}
          dayIndex={1}
          editing={false}
          onEditToggle={() => {}}
          dayDateLong="Tuesday, May 5"
          isRunning={false}
          liveElapsedMin={0}
        />,
      ),
    );
    expect(container.querySelector("svg.lucide-bot")).toBeNull();
  });

  it("TitleLineRow carries the badge when ANY folded entry is agent-started", () => {
    const ticket = {
      linked_ticket_key: "AE-644",
      linked_ticket_provider: "jira" as const,
      linked_ticket_url: "https://x/AE-644",
      description: "cutover implementation",
    };
    const line = groupEntriesByTitle(
      dayGrid({
        0: [makeEntry("e1", { ...ticket, duration_min: 60 })],
        1: [
          makeEntry("e2", {
            ...ticket,
            duration_min: 210,
            started_by_kind: "agent",
            agent_label: "Claude Code",
          }),
        ],
      }),
    )[0]!;
    const { container } = renderWithIntl(
      wrapInTable(
        <TitleLineRow
          line={line}
          expanded={false}
          onToggle={() => {}}
          controlsId="title-0-0"
          dayDatesLong={WEEK_DAYS_LONG}
          runningStartIso={null}
          runningNowMs={0}
        />,
      ),
    );
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
    expect(screen.getByText("via Claude Code")).toBeInTheDocument();
  });

  it("TitleLineDrawer header chip carries the rollup badge too (view parity)", () => {
    const rows = [
      {
        entry: makeEntry("e1", {
          started_by_kind: "agent",
          agent_label: "Claude Code",
        }),
        dayIndex: 0,
      },
      { entry: makeEntry("e2"), dayIndex: 1 },
    ];
    const { container } = renderWithIntl(
      wrapInTable(
        <TitleLineDrawer
          rows={rows}
          controlsId="title-0-0"
          dayDatesLong={WEEK_DAYS_LONG}
          taskLabel="AE-644"
          runningStartIso={null}
          runningNowMs={0}
          editingEntryId={null}
          onEditToggle={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
    expect(screen.getByText("via Claude Code")).toBeInTheDocument();
  });
});
