import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { renderWithIntl } from "@/test/intl";
import {
  bulkStripButtonClass,
  bulkStripDangerButtonClass,
} from "@/lib/table-styles";

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useSearchParams: () => mockSearchParams,
}));

const bulkArchive = vi.fn();
const bulkRestore = vi.fn();
const bulkSwitchSet = vi.fn();
const bulkClose = vi.fn();
const bulkReopen = vi.fn();
vi.mock("./actions", () => ({
  bulkArchiveProjectsAction: (fd: FormData) => bulkArchive(fd),
  bulkRestoreProjectsAction: (fd: FormData) => bulkRestore(fd),
  bulkSwitchCategorySetAction: (fd: FormData) => bulkSwitchSet(fd),
  bulkCloseProjectsAction: (fd: FormData) => bulkClose(fd),
  bulkReopenProjectsAction: (fd: FormData) => bulkReopen(fd),
}));

const toastPush = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ push: toastPush }),
}));

import { ProjectsTable, type ProjectRow } from "./projects-table";

const acme = { id: "c-1", name: "Acme Corp", logo_url: null };
const beta = { id: "c-2", name: "Beta Inc", logo_url: null };

function row(overrides: Partial<ProjectRow> & { id: string; name: string }): ProjectRow {
  return {
    team_id: "t-1",
    hourly_rate: 100,
    status: "active",
    projected_end_date: null,
    is_internal: false,
    parent_project_id: null,
    customers: acme,
    ...overrides,
  };
}

const projects: ProjectRow[] = [
  row({ id: "p-1", name: "Alpha" }),
  row({ id: "p-2", name: "Alpha Sub", parent_project_id: "p-1" }),
  // Orphan sub-project — parent filtered out of the visible page.
  row({ id: "p-3", name: "Orphan Sub", parent_project_id: "p-gone" }),
  row({ id: "p-4", name: "Solo", customers: beta }),
];

function renderTable(
  extra: Partial<Parameters<typeof ProjectsTable>[0]> = {},
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <ProjectsTable
      projects={projects}
      totalCount={4}
      teamNameById={new Map([["t-1", "Team One"]])}
      sort="name"
      dir="asc"
      categorySets={[{ id: "s-1", name: "Set One", is_system: false }]}
      {...extra}
    />,
  );
}

function selectAlpha(): HTMLElement {
  const checkbox = screen.getByRole("checkbox", { name: "Select Alpha" });
  fireEvent.click(checkbox);
  return checkbox;
}

beforeEach(() => {
  bulkArchive.mockReset().mockResolvedValue(undefined);
  bulkClose.mockReset().mockResolvedValue(undefined);
  bulkSwitchSet.mockReset().mockResolvedValue(undefined);
  bulkRestore.mockReset();
  bulkReopen.mockReset();
  toastPush.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectsTable — group headers & hierarchy semantics (C8)", () => {
  it("renders customer group headers as <th scope='rowgroup'> spanning every column", () => {
    const { container } = renderTable();
    const groupHeaders = container.querySelectorAll('th[scope="rowgroup"]');
    expect(groupHeaders).toHaveLength(2); // Acme Corp + Beta Inc
    for (const th of Array.from(groupHeaders)) {
      expect((th as HTMLTableCellElement).colSpan).toBe(5);
    }
    // No <td colSpan> stand-ins remain.
    expect(container.querySelector("td[colspan]")).toBeNull();
  });

  it("does not emit inert aria-level on plain-table rows", () => {
    const { container } = renderTable();
    expect(container.querySelector("[aria-level]")).toBeNull();
  });

  it("gives sub-project rows an sr-only 'Sub-project of {parent}' outside the link", () => {
    renderTable();
    const srOnly = screen.getByText("Sub-project of Alpha");
    expect(srOnly.className).toContain("sr-only");
    // The link's accessible name stays the project's own name.
    expect(
      screen.getByRole("link", { name: "Alpha Sub" }),
    ).toBeInTheDocument();
    // Orphan child (parent not on the page) gets no dangling label.
    expect(screen.getAllByText(/^Sub-project of/)).toHaveLength(1);
  });
});

describe("ProjectsTable — checkboxes (rule 4)", () => {
  it("styles all checkboxes with checkboxClass and names rows after the project", () => {
    renderTable();
    const checkboxes = screen.getAllByRole("checkbox");
    // 2 masters (strip + thead) + 4 rows.
    expect(checkboxes).toHaveLength(6);
    for (const cb of checkboxes) {
      expect(cb.className).toContain("h-4 w-4");
      expect(cb.className).toContain("cursor-pointer");
    }
    expect(
      screen.getByRole("checkbox", { name: "Select Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("checkbox", { name: "Select all projects" }),
    ).toHaveLength(2);
  });
});

describe("ProjectsTable — live region (a11y invariant)", () => {
  it("announces the result count, then the debounced selection count", () => {
    vi.useFakeTimers();
    renderTable();
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("4 projects listed");

    selectAlpha();
    // Debounced — not announced synchronously.
    expect(live).not.toHaveTextContent("selected");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(live).toHaveTextContent("1 project selected");
  });

  it("announces the result count in the empty state too", () => {
    renderWithIntl(
      <ProjectsTable
        projects={[]}
        totalCount={0}
        teamNameById={new Map()}
        sort="name"
        dir="asc"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("0 projects listed");
  });
});

describe("ProjectsTable — selection clearing", () => {
  it("shows a visible Clear button that empties the selection", () => {
    renderTable();
    selectAlpha();
    expect(screen.getByText("1 of 4 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("1 of 4 selected")).toBeNull();
    expect(
      screen.getByText("Select rows to archive in bulk"),
    ).toBeInTheDocument();
  });

  it("clears on Escape from a non-text control (a checkbox is an input, not a text editor)", () => {
    renderTable();
    const checkbox = selectAlpha();
    fireEvent.keyDown(checkbox, { key: "Escape" });
    expect(screen.queryByText("1 of 4 selected")).toBeNull();
  });

  it("does NOT clear on Escape while focus is in a text-editing control", () => {
    renderWithIntl(
      <div>
        <input type="text" aria-label="Unrelated text field" />
        <ProjectsTable
          projects={projects}
          totalCount={4}
          teamNameById={new Map([["t-1", "Team One"]])}
          sort="name"
          dir="asc"
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Unrelated text field" }),
      { key: "Escape" },
    );
    expect(screen.getByText("1 of 4 selected")).toBeInTheDocument();
  });
});

describe("ProjectsTable — bulk close (tier-1 inline confirm)", () => {
  it("arms an inline confirm instead of closing immediately, and cancels cleanly", () => {
    renderTable();
    selectAlpha();
    fireEvent.click(screen.getByRole("button", { name: "Close out 1" }));
    expect(bulkClose).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", {
      name: "Confirm close-out of 1",
    });
    expect(confirm).toHaveFocus();
    expect(confirm.className).toBe(bulkStripButtonClass);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bulkClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Close out 1" }),
    ).toBeInTheDocument();
  });

  it("runs the close action with the selected ids on confirm", async () => {
    renderTable();
    selectAlpha();
    fireEvent.click(screen.getByRole("button", { name: "Close out 1" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm close-out of 1" }),
    );
    await waitFor(() => expect(bulkClose).toHaveBeenCalledTimes(1));
    const fd = bulkClose.mock.calls[0]?.[0] as FormData;
    expect(fd.getAll("id")).toEqual(["p-1"]);
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success" }),
      ),
    );
  });

  it("disarms the confirm when the selection changes", () => {
    renderTable();
    selectAlpha();
    fireEvent.click(screen.getByRole("button", { name: "Close out 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Solo" }));
    expect(
      screen.queryByRole("button", { name: /Confirm close-out/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Close out 2" }),
    ).toBeInTheDocument();
  });
});

describe("ProjectsTable — bulk archive (danger chrome, no soft fill)", () => {
  it("uses bulkStripDangerButtonClass and archives the selection", async () => {
    renderTable();
    selectAlpha();
    const archive = screen.getByRole("button", { name: "Archive 1" });
    expect(archive.className).toBe(bulkStripDangerButtonClass);
    fireEvent.click(archive);
    await waitFor(() => expect(bulkArchive).toHaveBeenCalledTimes(1));
    const fd = bulkArchive.mock.calls[0]?.[0] as FormData;
    expect(fd.getAll("id")).toEqual(["p-1"]);
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success" }),
      ),
    );
  });
});

describe("ProjectsTable — bulk category-set picker", () => {
  it("closes on Escape, returns focus to the trigger, and keeps the selection", () => {
    renderTable();
    selectAlpha();
    const trigger = screen.getByRole("button", {
      name: "Switch category set",
    });
    expect(trigger.className).toBe(bulkStripButtonClass);
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", {
      name: "Pick a category set to apply",
    });
    fireEvent.keyDown(listbox, { key: "Escape" });
    expect(
      screen.queryByRole("listbox", { name: "Pick a category set to apply" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();
    // The consumed Escape must not fall through to clear-selection.
    expect(screen.getByText("1 of 4 selected")).toBeInTheDocument();
  });

  it("applies the picked set to the selection", async () => {
    renderTable();
    selectAlpha();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch category set" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Set One" }));
    await waitFor(() => expect(bulkSwitchSet).toHaveBeenCalledTimes(1));
    const fd = bulkSwitchSet.mock.calls[0]?.[0] as FormData;
    expect(fd.getAll("id")).toEqual(["p-1"]);
    expect(fd.get("category_set_id")).toBe("s-1");
  });
});
