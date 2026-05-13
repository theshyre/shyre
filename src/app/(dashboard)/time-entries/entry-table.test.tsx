import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { deleteManyMock, restoreManyMock } = vi.hoisted(() => ({
  deleteManyMock: vi.fn(async (_fd: FormData) => {}),
  restoreManyMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  updateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  duplicateTimeEntryAction: vi.fn(),
  startTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
  deleteTimeEntriesAction: deleteManyMock,
  restoreTimeEntriesAction: restoreManyMock,
}));

import { EntryTable } from "./entry-table";
import { ToastProvider } from "@/components/Toast";
import type { EntryGroup } from "@/lib/time/grouping";
import type { TimeEntry } from "./types";

function renderTable(ui: React.ReactElement): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

function makeEntry(id: string, opts?: {
  description?: string;
  start?: Date;
  durationMin?: number;
  billable?: boolean;
  categoryId?: string | null;
  projectName?: string;
}): TimeEntry {
  const start = opts?.start ?? new Date(2026, 3, 13, 10);
  const dur = opts?.durationMin ?? 60;
  const end = new Date(start.getTime() + dur * 60 * 1000);
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: opts?.description ?? `entry ${id}`,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: dur,
    billable: opts?.billable ?? true,
    github_issue: null,
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    category_id: opts?.categoryId ?? null,
    projects: { id: "p1", name: opts?.projectName ?? "Alpha", github_repo: null },
    author: null,
  };
}

function group(
  id: string,
  label: string,
  entries: TimeEntry[],
  extras: Partial<EntryGroup<TimeEntry>> = {},
): EntryGroup<TimeEntry> {
  return {
    id,
    label,
    entries,
    totalMin: entries.reduce((s, e) => s + (e.duration_min ?? 0), 0),
    billableMin: entries
      .filter((e) => e.billable)
      .reduce((s, e) => s + (e.duration_min ?? 0), 0),
    ...extras,
  };
}

describe("EntryTable", () => {
  it("renders table headers", () => {
    renderTable(
      <EntryTable
        groups={[group("g1", "Today", [makeEntry("a")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /time/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /duration/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /project/i })).toBeInTheDocument();
  });

  it("renders empty state when all groups are empty", () => {
    renderTable(
      <EntryTable
        groups={[]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText(/no time entries/i)).toBeInTheDocument();
  });

  it("renders group header with label and total in H:MM format", () => {
    renderTable(
      <EntryTable
        groups={[
          group("g1", "Feature", [makeEntry("a", { durationMin: 195 })], {
            color: "#3b82f6",
          }),
        ]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
      />,
    );
    expect(screen.getByText("Feature")).toBeInTheDocument();
    // 195 min → 3:15 (shows in group header AND entry row)
    const durations = screen.getAllByText("3:15");
    expect(durations.length).toBeGreaterThanOrEqual(1);
  });

  it("hides group header when hideGroupHeaders=true", () => {
    renderTable(
      <EntryTable
        groups={[group("g1", "Feature", [makeEntry("a")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    expect(screen.queryByText("Feature")).not.toBeInTheDocument();
  });

  it("shows H:MM duration for each entry", () => {
    renderTable(
      <EntryTable
        groups={[group("g1", "T", [makeEntry("a", { durationMin: 45 })])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    expect(screen.getByText("0:45")).toBeInTheDocument();
  });

  it("clicking a row calls onToggleExpand with the entry id", () => {
    const onToggle = vi.fn();
    renderTable(
      <EntryTable
        groups={[group("g1", "T", [makeEntry("a")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={onToggle}
        hideGroupHeaders
      />,
    );
    fireEvent.click(screen.getByText("entry a"));
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("selects rows via the bulk checkbox and deletes them", async () => {
    deleteManyMock.mockClear();
    const { container } = renderTable(
      <EntryTable
        groups={[
          group("g1", "T", [
            makeEntry("a"),
            makeEntry("b"),
            makeEntry("c"),
          ]),
        ]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    // Select two of the three rows.
    const rowCheckboxes = container.querySelectorAll<HTMLInputElement>(
      "tbody input[type='checkbox']",
    );
    expect(rowCheckboxes.length).toBe(3);
    rowCheckboxes[0]!.click();
    rowCheckboxes[1]!.click();
    // Bulk bar now shows "2 selected" + Delete.
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete selected/i }));
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await vi.waitFor(() => expect(deleteManyMock).toHaveBeenCalled());
    const fd = deleteManyMock.mock.calls[0]?.[0];
    expect(fd?.getAll("id").sort()).toEqual(["a", "b"]);
  });

  it("keeps column headers mounted and stable when selection is active", () => {
    const { container } = renderTable(
      <EntryTable
        groups={[group("g1", "T", [makeEntry("a"), makeEntry("b")])]}
        projects={[]}
        categories={[]}
        expandedEntryId={null}
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    // Baseline: grab the <th> widths from the header row.
    const theadBefore = container.querySelector("thead");
    expect(theadBefore).toBeTruthy();
    const headerCellsBefore = Array.from(
      theadBefore!.querySelectorAll("th"),
    );
    const headerTextsBefore = headerCellsBefore.map(
      (c) => c.textContent?.trim() ?? "",
    );

    // Select one row; the bulk strip should overlay, not swap headers.
    const rowCheckboxes = container.querySelectorAll<HTMLInputElement>(
      "tbody input[type='checkbox']",
    );
    rowCheckboxes[0]!.click();

    // Column header <th> cells still present with the same text — the
    // overlay is a separate element, the thead is not mutated.
    const headerCellsAfter = Array.from(
      container.querySelectorAll("thead th"),
    );
    const headerTextsAfter = headerCellsAfter.map(
      (c) => c.textContent?.trim() ?? "",
    );
    expect(headerTextsAfter).toEqual(headerTextsBefore);

    // Bulk strip is rendered as a sibling toolbar role, not inside thead.
    const toolbar = screen.getByRole("toolbar", { name: /bulk/i });
    expect(toolbar.tagName).toBe("DIV");
    expect(toolbar.closest("thead")).toBeNull();
  });

  it("renders the edit form spanning the table width when expanded", () => {
    renderTable(
      <EntryTable
        groups={[
          group("g1", "T", [
            makeEntry("a", { start: new Date(2026, 3, 13, 10) }),
          ]),
        ]}
        projects={[]}
        categories={[]}
        expandedEntryId="a"
        onToggleExpand={() => {}}
        hideGroupHeaders
      />,
    );
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeInTheDocument();
  });
});
