import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import {
  TableDensityProvider,
  useTableDensity,
} from "./table-density-provider";

/**
 * The provider:
 *   - reads density from localStorage on mount (falls back to "regular")
 *   - applies `data-density` to <html> on mount and on change
 *   - setDensity / applyExternalDensity both write to localStorage,
 *     dispatch the change event, and update the <html> attr
 *   - reading outside the provider throws
 */

function Probe(): React.JSX.Element {
  const { density, setDensity, applyExternalDensity, densities } =
    useTableDensity();
  return (
    <div>
      <span data-testid="d">{density}</span>
      <ul>
        {densities.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <button onClick={() => setDensity("compact")} data-testid="set-compact">
        compact
      </button>
      <button onClick={() => setDensity("comfortable")} data-testid="set-comfy">
        comfy
      </button>
      <button
        onClick={() => applyExternalDensity("regular")}
        data-testid="external-regular"
      >
        ext-regular
      </button>
    </div>
  );
}

describe("TableDensityProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-density");
  });

  it("defaults to 'regular' when localStorage is empty", () => {
    const { getByTestId } = render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    expect(getByTestId("d").textContent).toBe("regular");
  });

  it("applies data-density='regular' to <html> on mount when localStorage is empty", () => {
    render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "regular",
    );
  });

  it("reads existing density from localStorage on mount", () => {
    localStorage.setItem("stint-table-density", "compact");
    const { getByTestId } = render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    expect(getByTestId("d").textContent).toBe("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
  });

  it("ignores garbage values in localStorage (falls back to 'regular')", () => {
    localStorage.setItem("stint-table-density", "yoga-density");
    const { getByTestId } = render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    expect(getByTestId("d").textContent).toBe("regular");
  });

  it("setDensity writes to localStorage + updates the <html> attr + the rendered value", () => {
    const { getByTestId } = render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    act(() => {
      getByTestId("set-compact").click();
    });
    expect(localStorage.getItem("stint-table-density")).toBe("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
    expect(getByTestId("d").textContent).toBe("compact");
  });

  it("applyExternalDensity (used by Sync) behaves the same as setDensity", () => {
    localStorage.setItem("stint-table-density", "comfortable");
    const { getByTestId } = render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    expect(getByTestId("d").textContent).toBe("comfortable");
    act(() => {
      getByTestId("external-regular").click();
    });
    expect(localStorage.getItem("stint-table-density")).toBe("regular");
    expect(getByTestId("d").textContent).toBe("regular");
  });

  it("exports the three densities in order", () => {
    const { container } = render(
      <TableDensityProvider>
        <Probe />
      </TableDensityProvider>,
    );
    const items = container.querySelectorAll("li");
    expect(Array.from(items).map((li) => li.textContent)).toEqual([
      "compact",
      "regular",
      "comfortable",
    ]);
  });

  it("useTableDensity throws when called outside the provider", () => {
    expect(() => {
      // Suppress the React error boundary noise — render a probe
      // without the provider and expect a throw on the hook.
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        render(<Probe />);
      } finally {
        consoleSpy.mockRestore();
      }
    }).toThrow(/TableDensityProvider/);
  });
});

import { vi } from "vitest";
