import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams("org=o1&interval=month"),
}));

import { ViewToggle } from "./view-toggle";

describe("ViewToggle", () => {
  beforeEach(() => pushMock.mockClear());

  it("renders Day and Week buttons", () => {
    renderWithIntl(<ViewToggle view="week" />);
    expect(screen.getByRole("button", { name: /day/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /week/i })).toBeInTheDocument();
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
});
