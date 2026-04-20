import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { duplicateMock, deleteMock, startTimerMock } = vi.hoisted(() => ({
  duplicateMock: vi.fn(async (_fd: FormData) => {}),
  deleteMock: vi.fn(async (_fd: FormData) => {}),
  startTimerMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  duplicateTimeEntryAction: duplicateMock,
  deleteTimeEntryAction: deleteMock,
  startTimerAction: startTimerMock,
}));

import { EntryKebabMenu } from "./entry-kebab-menu";
import { ToastProvider } from "@/components/Toast";
import type { TimeEntry } from "./types";

function renderMenu(ui: React.ReactElement): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

const entry: TimeEntry = {
  id: "e1",
  team_id: "o1",
  user_id: "u1",
  project_id: "p1",
  description: "test",
  start_time: new Date().toISOString(),
  end_time: new Date().toISOString(),
  duration_min: 60,
  billable: true,
  github_issue: null,
  category_id: null,
  projects: { id: "p1", name: "Alpha", github_repo: null },
  author: null,
};

describe("EntryKebabMenu", () => {
  beforeEach(() => {
    duplicateMock.mockClear();
    deleteMock.mockClear();
  });

  it("is closed by default", () => {
    renderMenu(<EntryKebabMenu entry={entry} onEdit={() => {}} />);
    expect(screen.queryByText(/edit/i)).not.toBeInTheDocument();
  });

  it("opens when the trigger is clicked", () => {
    renderMenu(<EntryKebabMenu entry={entry} onEdit={() => {}} />);
    fireEvent.click(screen.getByLabelText(/entry actions/i));
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onEdit when Edit is clicked and closes the menu", () => {
    const onEdit = vi.fn();
    renderMenu(<EntryKebabMenu entry={entry} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText(/entry actions/i));
    fireEvent.click(screen.getByText("Edit"));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("calls duplicate action when Duplicate clicked", async () => {
    renderMenu(<EntryKebabMenu entry={entry} onEdit={() => {}} />);
    fireEvent.click(screen.getByLabelText(/entry actions/i));
    fireEvent.click(screen.getByText("Duplicate"));
    await waitFor(() => expect(duplicateMock).toHaveBeenCalled());
    const fd = duplicateMock.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
  });

  it("requires two clicks to delete (Delete → Confirm delete)", async () => {
    renderMenu(<EntryKebabMenu entry={entry} onEdit={() => {}} />);
    fireEvent.click(screen.getByLabelText(/entry actions/i));
    // First click reveals confirm
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteMock).not.toHaveBeenCalled();
    const confirmBtn = screen.getByText(/confirm delete/i);
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(deleteMock).toHaveBeenCalled());
  });

  it("closes on Escape", () => {
    renderMenu(<EntryKebabMenu entry={entry} onEdit={() => {}} />);
    fireEvent.click(screen.getByLabelText(/entry actions/i));
    expect(screen.getByText("Edit")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("Start timer seeds the action with the entry's project + description", async () => {
    startTimerMock.mockClear();
    const entryWithCategory: TimeEntry = {
      ...entry,
      project_id: "p-seed",
      category_id: "c-seed",
      description: "seed description",
    };
    renderMenu(
      <EntryKebabMenu entry={entryWithCategory} onEdit={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/entry actions/i));
    fireEvent.click(screen.getByText(/start timer/i));
    await waitFor(() => expect(startTimerMock).toHaveBeenCalled());
    const fd = startTimerMock.mock.calls[0]?.[0];
    expect(fd?.get("project_id")).toBe("p-seed");
    expect(fd?.get("category_id")).toBe("c-seed");
    expect(fd?.get("description")).toBe("seed description");
  });
});
