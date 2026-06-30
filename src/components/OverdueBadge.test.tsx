import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverdueBadge } from "./OverdueBadge";

describe("OverdueBadge", () => {
  it("renders the label text", () => {
    render(<OverdueBadge label="Overdue" tooltip="Projected end was Jun 15, 2026" />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("uses the warning (amber) palette, not error red", () => {
    const { container } = render(
      <OverdueBadge label="Overdue" tooltip="x" />,
    );
    // The pill itself carries the warning palette.
    const pill = container.querySelector(".bg-warning-soft");
    expect(pill).not.toBeNull();
    expect(container.innerHTML).not.toContain("bg-error");
  });
});
