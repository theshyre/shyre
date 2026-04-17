import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { updateMock } = vi.hoisted(() => ({
  updateMock: vi.fn(async (_fd: FormData) => ({ success: true })),
}));

vi.mock("./actions", () => ({
  updateTimeEntryAction: updateMock,
  deleteTimeEntryAction: vi.fn(),
  duplicateTimeEntryAction: vi.fn(),
}));

import { InlineEditForm } from "./inline-edit-form";
import type { TimeEntry } from "./types";

const project = { id: "p1", name: "Alpha", github_repo: null, team_id: "o1", category_set_id: null, require_timestamps: true };
const entry: TimeEntry = {
  id: "e1",
  team_id: "o1",
  user_id: "u1",
  project_id: "p1",
  description: "original",
  start_time: new Date(2026, 3, 13, 9).toISOString(),
  end_time: new Date(2026, 3, 13, 10).toISOString(),
  duration_min: 60,
  billable: true,
  github_issue: null,
  category_id: null,
  projects: project,
  author: null,
};

describe("InlineEditForm", () => {
  beforeEach(() => {
    updateMock.mockClear();
  });

  it("populates fields from the entry", () => {
    const { container } = renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={() => {}} />,
    );
    const desc = container.querySelector<HTMLInputElement>('input[name="description"]');
    expect(desc?.value).toBe("original");
    const billable = container.querySelector<HTMLInputElement>('input[name="billable"]');
    expect(billable?.checked).toBe(true);
  });

  it("autofocuses the description field", () => {
    const { container } = renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={() => {}} />,
    );
    const desc = container.querySelector('input[name="description"]');
    expect(desc).toHaveFocus();
  });

  it("Cancel button calls onDone", () => {
    const onDone = vi.fn();
    renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={onDone} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onDone).toHaveBeenCalled();
  });

  it("submits form and calls onDone on success", async () => {
    const onDone = vi.fn();
    renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={onDone} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const fd = updateMock.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
  });

  it("Escape key calls onDone", () => {
    const onDone = vi.fn();
    renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={onDone} />,
    );
    const form = screen.getByRole("button", { name: /save changes/i }).closest("form")!;
    fireEvent.keyDown(form, { key: "Escape" });
    expect(onDone).toHaveBeenCalled();
  });
});
