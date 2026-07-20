import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FinancialDisclosure } from "./financial-disclosure";

describe("FinancialDisclosure", () => {
  function setup(): void {
    render(
      <FinancialDisclosure showLabel="Show financials" hideLabel="Hide financials">
        <span>NET +$41,682.58</span>
      </FinancialDisclosure>,
    );
  }

  it("keeps the financials OUT of the DOM until explicitly opened", () => {
    setup();
    // Privacy control: collapsed means absent, not visually hidden —
    // nothing for a screen-share (or screen reader) to pick up.
    expect(screen.queryByText(/NET/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Show financials" });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on click and can be re-hidden", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Show financials" }));
    expect(screen.getByText(/NET/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Hide financials" });
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(screen.queryByText(/NET/)).not.toBeInTheDocument();
  });
});
