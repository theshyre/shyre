import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { TableDensityProvider } from "./table-density-provider";
import { TableDensitySync } from "./TableDensitySync";

describe("TableDensitySync (DB → provider one-way sync)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-density");
  });

  it("applies the server-read preference when it differs from the current density", () => {
    render(
      <TableDensityProvider>
        <TableDensitySync preferredDensity="compact" />
      </TableDensityProvider>,
    );
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
  });

  it("does not apply anything when preferredDensity is null", () => {
    localStorage.setItem("stint-table-density", "regular");
    render(
      <TableDensityProvider>
        <TableDensitySync preferredDensity={null} />
      </TableDensityProvider>,
    );
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "regular",
    );
  });

  it("is a no-op when the server value matches the current density", () => {
    localStorage.setItem("stint-table-density", "comfortable");
    render(
      <TableDensityProvider>
        <TableDensitySync preferredDensity="comfortable" />
      </TableDensityProvider>,
    );
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "comfortable",
    );
  });
});
