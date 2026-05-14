import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();

let currentSearchParams = "org=o1&interval=month";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

import { ViewToggle } from "./view-toggle";

describe("ViewToggle", () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentSearchParams = "org=o1&interval=month";
  });

  it("renders Log / Day / Week / Table buttons", () => {
    renderWithIntl(<ViewToggle view="week" />);
    expect(screen.getByRole("button", { name: /log/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /day/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /week/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /table/i })).toBeInTheDocument();
  });

  it("marks the active view aria-pressed=true", () => {
    renderWithIntl(<ViewToggle view="day" />);
    expect(screen.getByRole("button", { name: /day/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /week/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking Day sets ?view=day and clears stale interval params", () => {
    renderWithIntl(<ViewToggle view="week" />);
    fireEvent.click(screen.getByRole("button", { name: /day/i }));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/view=day/);
    expect(call).not.toMatch(/interval=/);
    expect(call).toMatch(/org=o1/);
  });

  it("clicking Week removes ?view param (default)", () => {
    renderWithIntl(<ViewToggle view="day" />);
    fireEvent.click(screen.getByRole("button", { name: /week/i }));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/view=/);
    expect(call).toMatch(/org=o1/);
  });

  it("pressing D switches to day view", () => {
    renderWithIntl(<ViewToggle view="week" />);
    // Fire on document.body — it bubbles to the window-level listener
    // the component registers, and testing-library's fireEvent reliably
    // attaches the `key` field here (unlike with `window` as target).
    fireEvent.keyDown(document.body, { key: "d" });
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/view=day/);
  });

  it("pressing W switches to week view", () => {
    renderWithIntl(<ViewToggle view="day" />);
    fireEvent.keyDown(document.body, { key: "w" });
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/view=/);
  });

  it("ignores D / W when typing in an input", () => {
    const { container } = renderWithIntl(
      <>
        <input data-testid="sink" />
        <ViewToggle view="week" />
      </>,
    );
    const input = container.querySelector<HTMLInputElement>(
      "input[data-testid=sink]",
    )!;
    input.focus();
    fireEvent.keyDown(input, { key: "d" });
    fireEvent.keyDown(input, { key: "w" });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("ignores modified keystrokes so Cmd/Ctrl+D (bookmark) still works", () => {
    renderWithIntl(<ViewToggle view="week" />);
    fireEvent.keyDown(document.body, { key: "d", metaKey: true });
    fireEvent.keyDown(document.body, { key: "d", ctrlKey: true });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("pressing T switches to table view", () => {
    renderWithIntl(<ViewToggle view="week" />);
    fireEvent.keyDown(document.body, { key: "t" });
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/view=table/);
  });

  it("leaving table strips table-only params from the URL", () => {
    // User on Table view with active filters → switching to Week
    // must not carry ?from / ?to / ?q / ?invoiced over — those
    // would silently scope the Week view's query.
    currentSearchParams = "view=table&from=2026-01-01&to=2026-03-01&q=foo&invoiced=uninvoiced";
    renderWithIntl(<ViewToggle view="table" />);
    fireEvent.click(screen.getByRole("button", { name: /week/i }));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/from=/);
    expect(call).not.toMatch(/to=/);
    expect(call).not.toMatch(/q=/);
    expect(call).not.toMatch(/invoiced=/);
    expect(call).not.toMatch(/view=/);
  });

  it("entering table preserves the user-set filters that table cares about", () => {
    // No carry-in case (URL has none of the table params) — just
    // verify the switch lands on the table view cleanly.
    currentSearchParams = "org=o1";
    renderWithIntl(<ViewToggle view="day" />);
    fireEvent.click(screen.getByRole("button", { name: /table/i }));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/view=table/);
    expect(call).toMatch(/org=o1/);
  });
});
