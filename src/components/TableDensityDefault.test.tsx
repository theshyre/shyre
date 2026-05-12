import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { TableDensityProvider } from "./table-density-provider";
import { TableDensityDefault } from "./TableDensityDefault";

describe("TableDensityDefault", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-density");
  });

  it("applies the preferred density when localStorage is empty (user never picked)", () => {
    render(
      <TableDensityProvider>
        <TableDensityDefault preferred="compact" />
      </TableDensityProvider>,
    );
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
  });

  it("does NOT override when the user has already picked (localStorage has any value)", () => {
    localStorage.setItem("stint-table-density", "comfortable");
    render(
      <TableDensityProvider>
        <TableDensityDefault preferred="compact" />
      </TableDensityProvider>,
    );
    // User pick (comfortable) wins; preferred (compact) is ignored.
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "comfortable",
    );
  });

  it("is a no-op when the current density already matches preferred", () => {
    localStorage.setItem("stint-table-density", "regular");
    render(
      <TableDensityProvider>
        <TableDensityDefault preferred="regular" />
      </TableDensityProvider>,
    );
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "regular",
    );
  });

  it("renders nothing visible (returns null)", () => {
    const { container } = render(
      <TableDensityProvider>
        <TableDensityDefault preferred="compact" />
      </TableDensityProvider>,
    );
    // The provider wrapper renders nothing on its own, so the test
    // root has only an empty fragment.
    expect(container.textContent).toBe("");
  });
});
