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

const project = { id: "p1", name: "Alpha", github_repo: null, jira_project_key: null, team_id: "o1", category_set_id: null, require_timestamps: true };
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
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
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
    // Description is a textarea now (multi-line) — was a single-line
    // input that truncated long Harvest-imported text.
    const desc = container.querySelector<HTMLTextAreaElement>('textarea[name="description"]');
    expect(desc?.value).toBe("original");
    const billable = container.querySelector<HTMLInputElement>('input[name="billable"]');
    expect(billable?.checked).toBe(true);
  });

  it("autofocuses the description field", () => {
    const { container } = renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={() => {}} />,
    );
    const desc = container.querySelector('textarea[name="description"]');
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
    const { container } = renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={onDone} />,
    );
    // Save is now gated on form dirtiness — type something into
    // description so the button enables.
    const desc = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]',
    )!;
    fireEvent.input(desc, { target: { value: "edited description" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const fd = updateMock.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
  });

  it("Save is disabled until the form is dirty", () => {
    renderWithIntl(
      <InlineEditForm entry={entry} projects={[project]} categories={[]} onDone={() => {}} />,
    );
    const save = screen.getByRole("button", {
      name: /save changes/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("submits the picked project_id when the user changes the project", async () => {
    const p2 = {
      id: "p2",
      name: "Beta",
      github_repo: null,
      jira_project_key: null,
      team_id: "o1",
      category_set_id: null,
      require_timestamps: true,
    };
    const { container } = renderWithIntl(
      <InlineEditForm
        entry={entry}
        projects={[project, p2]}
        categories={[]}
        onDone={() => {}}
      />,
    );
    const select = container.querySelector<HTMLSelectElement>(
      'select[name="project_id"]',
    )!;
    expect(select).toBeTruthy();
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("p1");
    fireEvent.change(select, { target: { value: "p2" } });
    expect(select.value).toBe("p2");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const fd = updateMock.mock.calls[0]?.[0];
    expect(fd?.get("project_id")).toBe("p2");
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

  it("syncs the description textarea when entry.description changes (apply-title path)", () => {
    // The chip's "Use as description" action mutates entry.description
    // server-side and revalidates the page; the open form re-renders
    // with a fresh prop. With the textarea uncontrolled (defaultValue)
    // the open form kept the stale text — the visible bug. With it
    // controlled + useEffect, the textarea reflects the new value.
    const { rerender, container } = renderWithIntl(
      <InlineEditForm
        entry={entry}
        projects={[project]}
        categories={[]}
        onDone={() => {}}
      />,
    );
    const desc = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]',
    );
    expect(desc?.value).toBe("original");

    rerender(
      <InlineEditForm
        entry={{ ...entry, description: "AE-640 Fix login bug" }}
        projects={[project]}
        categories={[]}
        onDone={() => {}}
      />,
    );
    const descAfter = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]',
    );
    expect(descAfter?.value).toBe("AE-640 Fix login bug");
  });
});
