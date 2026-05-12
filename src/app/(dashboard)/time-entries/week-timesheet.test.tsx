import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(),
}));

const { upsertCellMock, deleteMock, restoreBatchMock } = vi.hoisted(() => ({
  upsertCellMock: vi.fn(async (_fd: FormData) => {}),
  deleteMock: vi.fn(async (_fd: FormData) => {}),
  restoreBatchMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  upsertTimesheetCellAction: upsertCellMock,
  deleteTimeEntryAction: deleteMock,
  restoreTimeEntriesAction: restoreBatchMock,
  startTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
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
  jira_project_key: null,
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
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    category_id: opts.categoryId ?? null,
    projects: { id: "p1", name: "Alpha", github_repo: null },
    author: null,
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

  // Regression — bug 2026-05-06: when a project becomes a parent
  // (because the user added a sub-project under it), historical
  // time entries on that parent must still render with the parent's
  // name + customer. Earlier the time-entries page filtered parents
  // out of the `projects` array used as the rendering lookup map,
  // causing those rows to silently render as "No project / No
  // customer." Caller now passes the FULL project list (parents +
  // leaves) to WeekTimesheet, so the lookup resolves.
  it("renders entries whose project is a parent (has sub-projects) — does NOT drop them as 'No project'", () => {
    const parent: ProjectOption = {
      id: "p-engagement",
      name: "Engagement",
      github_repo: null,
      jira_project_key: null,
      team_id: "o1",
      category_set_id: null,
      require_timestamps: false,
    };
    const child: ProjectOption = {
      id: "p-phase-1",
      name: "Phase 1",
      github_repo: null,
      jira_project_key: null,
      team_id: "o1",
      category_set_id: null,
      require_timestamps: false,
    };
    // Entry on the parent — pre-existing data from before the
    // sub-project was created.
    const start = new Date(Date.UTC(2026, 3, 13, 0, 0));
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const entry: TimeEntry = {
      id: "e-parent",
      team_id: "o1",
      user_id: "u1",
      project_id: "p-engagement",
      description: null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
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
      projects: { id: "p-engagement", name: "Engagement", github_repo: null },
      author: null,
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[entry]}
        projects={[parent, child]}
        categories={[]}
      />,
    );
    // The parent's name should render as the row label. If the
    // lookup map were leaf-only, "Engagement" would be missing
    // from the DOM and a "No project" placeholder would appear.
    expect(screen.getByText("Engagement")).toBeInTheDocument();
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

  it("delete row → typed-confirm, soft-deletes entries, Undo toast restores", async () => {
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
    // Click trash, type `delete`, hit the red Delete button
    fireEvent.click(screen.getByRole("button", { name: /delete row/i }));
    const input = screen.getByLabelText(/type delete to confirm/i);
    fireEvent.change(input, { target: { value: "delete" } });
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
    // Before clicking: just the group-by selector is in the DOM.
    const before = screen.getAllByRole("combobox").length;
    // Empty-state surfaces "Add your first row"; populated weeks show
    // "Add row". Match either by anchoring on "Add" + "row".
    fireEvent.click(screen.getByRole("button", { name: /add (your first )?row/i }));
    // After clicking: project picker (and category picker when applicable)
    // get added on top of the group-by selector.
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(before);
  });

  it("splits into per-author rows when entries span multiple users", () => {
    // u1 (viewer) and u2 both logged to the same project/category on the
    // same day. The grid should render two rows, not a single summed row.
    const mine = makeEntry("m1", { day: 0, durationMin: 60 });
    const theirs: TimeEntry = {
      ...makeEntry("t1", { day: 0, durationMin: 120 }),
      user_id: "u2",
      author: { user_id: "u2", display_name: "Riley Member", avatar_url: null },
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[mine, theirs]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // Author chip appears in the foreign row only.
    expect(screen.getByText(/riley member/i)).toBeInTheDocument();
  });

  it("renders other-author rows as read-only (no editable textbox for their cells)", async () => {
    const theirs: TimeEntry = {
      ...makeEntry("t1", { day: 0, durationMin: 120 }),
      user_id: "u2",
      author: { user_id: "u2", display_name: "Riley", avatar_url: null },
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[theirs]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // No DurationInput textboxes render for the foreign-only grid; the
    // cell shows the duration as static text.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    // And the read-only cell still shows the duration value (repeated
    // across cell + row total + daily total).
    expect(screen.getAllByText("2:00").length).toBeGreaterThanOrEqual(1);
  });

  it("hides the delete button on other-author rows", () => {
    const theirs: TimeEntry = {
      ...makeEntry("t1", { day: 0, durationMin: 60 }),
      user_id: "u2",
      author: { user_id: "u2", display_name: "Riley", avatar_url: null },
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[theirs]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /delete row/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a group header for the current user when grouping by member", () => {
    // Clear localStorage so the default "member" grouping applies.
    window.localStorage.removeItem("shyre.weekTimesheet.groupBy");
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("e1", { day: 0, durationMin: 60 })]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // The current-user group's label is "You".
    expect(screen.getByText(/^you$/i)).toBeInTheDocument();
  });

  it("collapses a group when its chevron is clicked", async () => {
    window.localStorage.removeItem("shyre.weekTimesheet.groupBy");
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("e1", { day: 0, durationMin: 60 })]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // DurationInput renders as a textbox while the group is expanded.
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /collapse group/i }));
    // When collapsed, no row textboxes are in the DOM — only the header row.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("switching to project grouping renders per-row author chips", () => {
    window.localStorage.setItem("shyre.weekTimesheet.groupBy", "project");
    const theirs: TimeEntry = {
      ...makeEntry("t1", { day: 0, durationMin: 60 }),
      user_id: "u2",
      author: { user_id: "u2", display_name: "Riley Member", avatar_url: null },
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("m1", { day: 0, durationMin: 30 }), theirs]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // With member as the non-grouping dimension, each row carries an author
    // chip. Riley's name shows up on the non-own row.
    expect(screen.getByText(/riley member/i)).toBeInTheDocument();
    // Project name appears once — in the group header, not on every row.
    window.localStorage.removeItem("shyre.weekTimesheet.groupBy");
  });

  it("collapses other-member groups by default when grouping by member", () => {
    // 2 groups: own ("You") and Riley's. Default should keep "You"
    // expanded and Riley's collapsed so the editable work stays on top
    // without drowning the grid in other people's entries.
    window.localStorage.removeItem("shyre.weekTimesheet.groupBy");
    const theirs: TimeEntry = {
      ...makeEntry("t1", { day: 0, durationMin: 120 }),
      user_id: "u2",
      author: { user_id: "u2", display_name: "Riley", avatar_url: null },
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("m1", { day: 0, durationMin: 60 }), theirs]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // Own-group expanded → at least one DurationInput renders.
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
    // Riley's group is collapsed by default → the "Collapse group" button
    // (expanded state) only appears for the "You" group. Exactly one
    // expanded chevron is present.
    const collapseButtons = screen.getAllByRole("button", {
      name: /collapse group/i,
    });
    expect(collapseButtons).toHaveLength(1);
  });

  it("day headers link to the day view with anchor set to that day", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[]}
        projects={[project]}
        categories={[]}
      />,
    );
    // One day-jump link per day column (7 total). Each link carries
    // view=day and its own anchor param — Monday → 2026-04-13, etc.
    const dayLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.includes("view=day"));
    expect(dayLinks).toHaveLength(7);
    const monday = dayLinks.find((a) =>
      a.getAttribute("href")?.includes("anchor=2026-04-13"),
    );
    expect(monday).toBeTruthy();
    const sunday = dayLinks.find((a) =>
      a.getAttribute("href")?.includes("anchor=2026-04-19"),
    );
    expect(sunday).toBeTruthy();
  });

  it("Expand all / Collapse all buttons toggle every group at once", () => {
    window.localStorage.removeItem("shyre.weekTimesheet.groupBy");
    const theirs: TimeEntry = {
      ...makeEntry("t1", { day: 0, durationMin: 120 }),
      user_id: "u2",
      author: { user_id: "u2", display_name: "Riley", avatar_url: null },
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[makeEntry("m1", { day: 0, durationMin: 60 }), theirs]}
        projects={[project]}
        categories={[]}
        currentUserId="u1"
      />,
    );
    // Default: 1 expanded (You), 1 collapsed (Riley).
    fireEvent.click(
      screen.getByRole("button", { name: /^expand all/i }),
    );
    expect(
      screen.getAllByRole("button", { name: /collapse group/i }),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: /^collapse all/i }),
    );
    expect(
      screen.queryAllByRole("button", { name: /collapse group/i }),
    ).toHaveLength(0);
  });

  // Persona-converged design: collapsed rows aren't mute on the
  // most-identifying field. Single-entry rows surface the ticket
  // chip + description inline; multi-entry rows show a count badge
  // (the auto-expanded sub-rows below carry the per-entry detail).
  it("single-entry row renders the ticket key + description inline on the summary", () => {
    const e: TimeEntry = {
      ...makeEntry("e1", { day: 0, durationMin: 60 }),
      description: "Fix login flash on Safari",
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-642",
      linked_ticket_url: "https://example.atlassian.net/browse/AE-642",
    };
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[e]}
        projects={[project]}
        categories={[]}
      />,
    );
    expect(screen.getByText("AE-642")).toBeInTheDocument();
    // Sr-only + visible spans both carry the description text.
    expect(
      screen.getAllByText(/Fix login flash on Safari/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("multi-entry row renders a count badge instead of sampling tickets", () => {
    const entries: TimeEntry[] = [
      {
        ...makeEntry("e1", { day: 0, durationMin: 30 }),
        description: "First",
        linked_ticket_provider: "jira",
        linked_ticket_key: "AE-642",
      },
      {
        ...makeEntry("e2", { day: 0, durationMin: 30 }),
        description: "Second",
        linked_ticket_provider: "jira",
        linked_ticket_key: "AE-643",
      },
      {
        ...makeEntry("e3", { day: 1, durationMin: 45 }),
        description: "Third",
        linked_ticket_provider: "jira",
        linked_ticket_key: "AE-644",
      },
    ];
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={entries}
        projects={[project]}
        categories={[]}
      />,
    );
    // The summary badge names the count, not specific tickets.
    expect(screen.getByText(/3 entries/i)).toBeInTheDocument();
  });

  it("row with zero entries does not render an entry detail line", () => {
    renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[]}
        projects={[project]}
        categories={[]}
      />,
    );
    // No "entries" count, no ticket chip — the empty state is intact.
    expect(screen.queryByText(/entries/i)).toBeNull();
  });

  // Entity identity rule (CLAUDE.md): every customer reference gets
  // a stable visual identity-mark in addition to the text name.
  it("renders a CustomerChip next to the customer name on the row", () => {
    const projectWithCustomer: ProjectOption = {
      ...project,
      customers: { id: "cust-1", name: "Acme Corp" },
    };
    const e = makeEntry("e1", {
      day: 0,
      durationMin: 60,
      projectId: projectWithCustomer.id,
    });
    // makeEntry's hardcoded projects field would override; rewrite it
    // here so the row resolves the customer.
    const entry: TimeEntry = {
      ...e,
      projects: {
        id: projectWithCustomer.id,
        name: projectWithCustomer.name,
        github_repo: null,
      },
    };
    const { container } = renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[entry]}
        projects={[projectWithCustomer]}
        categories={[]}
      />,
    );
    // Chip is aria-hidden with 2-letter initials. Acme Corp → "AC".
    const chips = container.querySelectorAll(
      "span[aria-hidden='true']",
    );
    const acmeChip = Array.from(chips).find(
      (el) => el.textContent === "AC",
    );
    expect(acmeChip).toBeDefined();
  });

  // Customer sub-grouping (persona-converged design, 2026-05-12).
  // When two or more rows in a Member group share a customer, the
  // chip + name lift into a sub-header (<th scope="rowgroup">) and
  // the per-row customer line disappears so contiguous same-customer
  // rows don't repeat themselves.
  it("emits a customer sub-header (rowgroup) when two rows share a customer", () => {
    const projA: ProjectOption = {
      ...project,
      id: "p-a",
      name: "Project A",
      customers: { id: "cust-eyereg", name: "EyeReg Consulting" },
    };
    const projB: ProjectOption = {
      ...project,
      id: "p-b",
      name: "Project B",
      customers: { id: "cust-eyereg", name: "EyeReg Consulting" },
    };
    const entryA = makeEntry("e1", { day: 0, durationMin: 60, projectId: "p-a" });
    const entryB = makeEntry("e2", { day: 1, durationMin: 30, projectId: "p-b" });
    // Override the projects lookup to point each entry at its own project.
    const e1: TimeEntry = {
      ...entryA,
      projects: { id: "p-a", name: "Project A", github_repo: null },
    };
    const e2: TimeEntry = {
      ...entryB,
      projects: { id: "p-b", name: "Project B", github_repo: null },
    };
    const { container } = renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[e1, e2]}
        projects={[projA, projB]}
        categories={[]}
      />,
    );
    // Sub-header is a <th scope="rowgroup"> with the customer name.
    const rowgroup = container.querySelector("th[scope='rowgroup']");
    expect(rowgroup).not.toBeNull();
    expect(rowgroup?.textContent).toMatch(/EyeReg Consulting/);
    // Customer name should appear exactly ONCE on the page — in the
    // sub-header — even though two rows belong to that customer.
    const allCustomerMentions = screen.getAllByText("EyeReg Consulting");
    expect(allCustomerMentions).toHaveLength(1);
  });

  it("emits a customer sub-header even for a single-row customer (consistency)", () => {
    // Prior iteration auto-inlined 1-row customers; that produced two
    // visual languages inside the same Member group. Now every customer
    // reads the same — single-row customers also get a sub-header.
    const projWithCustomer: ProjectOption = {
      ...project,
      customers: { id: "cust-solo", name: "Solo Customer" },
    };
    const entry = makeEntry("e1", { day: 0, durationMin: 60 });
    const e: TimeEntry = {
      ...entry,
      projects: { id: project.id, name: project.name, github_repo: null },
    };
    const { container } = renderTimesheet(
      <WeekTimesheet
        weekStartStr={weekStartStr}
        tzOffsetMin={tzOffsetMin}
        entries={[e]}
        projects={[projWithCustomer]}
        categories={[]}
      />,
    );
    const rowgroup = container.querySelector("th[scope='rowgroup']");
    expect(rowgroup).not.toBeNull();
    expect(rowgroup?.textContent).toMatch(/Solo Customer/);
    // Customer name appears exactly once — in the sub-header, not
    // also on the row beneath it.
    expect(screen.getAllByText("Solo Customer")).toHaveLength(1);
  });
});
