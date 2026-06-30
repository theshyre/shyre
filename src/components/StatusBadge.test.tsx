import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the passed-in label text", () => {
    render(<StatusBadge status="active" label="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies the per-status color classes", () => {
    const { container } = render(
      <StatusBadge status="completed" label="Closed" />,
    );
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).toContain("bg-info-soft");
    expect(pill.className).toContain("text-info-text");
  });

  it("falls back to neutral classes for an unknown status", () => {
    const { container } = render(
      <StatusBadge status="mystery" label="Mystery" />,
    );
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).toContain("bg-surface-inset");
  });

  it("hides the decorative color dot from assistive tech", () => {
    const { container } = render(<StatusBadge status="active" label="Active" />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
  });
});
