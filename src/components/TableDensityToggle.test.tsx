import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TableDensityProvider } from "./table-density-provider";

const updateMock = vi.fn(async () => undefined);
vi.mock("./table-density-action", () => ({
  updateTableDensityAction: (...args: unknown[]) => updateMock(...args),
}));

import { TableDensityToggle } from "./TableDensityToggle";

function wrapped(): React.JSX.Element {
  return (
    <TableDensityProvider>
      <TableDensityToggle />
    </TableDensityProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-density");
  updateMock.mockClear();
});

describe("TableDensityToggle", () => {
  it("renders the three density buttons with aria-pressed reflecting the current value", () => {
    render(wrapped());
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    // Default density is "regular" → middle button is pressed.
    const labels = buttons.map((b) => b.getAttribute("aria-pressed"));
    expect(labels).toEqual(["false", "true", "false"]);
  });

  it("clicking 'Compact' flips the active button and persists to localStorage", () => {
    render(wrapped());
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]!);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("stint-table-density")).toBe("compact");
  });

  it("clicking the already-active button is a no-op (no server action fired)", () => {
    render(wrapped());
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]!);
    // "regular" was already active.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clicking a non-active button fires the server action with the new density", () => {
    render(wrapped());
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[2]!);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const fd = updateMock.mock.calls[0]?.[0] as FormData;
    expect(fd.get("table_density")).toBe("comfortable");
  });

  it("server-action rejection does NOT crash or revert local state (fire-and-forget)", async () => {
    updateMock.mockRejectedValueOnce(new Error("server failed"));
    render(wrapped());
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]!);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("stint-table-density")).toBe("compact");
    // No throw bubbles up.
  });
});
