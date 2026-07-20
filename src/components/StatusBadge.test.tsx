import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

/** Render a badge and return its pill className. The behavior under
 *  test is the color MAPPING (which statuses look alike / different),
 *  not the specific utility tokens — asserting on token substrings
 *  broke every time the design palette was retuned. */
function pillClassName(status: string): string {
  const { container, unmount } = render(
    <StatusBadge status={status} label="Any" />,
  );
  const pill = container.firstElementChild;
  expect(pill).toBeInstanceOf(HTMLElement);
  const className = pill instanceof HTMLElement ? pill.className : "";
  unmount();
  return className;
}

describe("StatusBadge", () => {
  it("renders the passed-in label text", () => {
    render(<StatusBadge status="active" label="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("gives each live lifecycle status a distinct visual treatment", () => {
    // active / paused / completed must be tellable apart at a glance —
    // if two ever collapse to the same classes, the color channel of
    // the two-channel encoding is silently gone.
    const active = pillClassName("active");
    const paused = pillClassName("paused");
    const completed = pillClassName("completed");
    expect(active).not.toBe(paused);
    expect(active).not.toBe(completed);
    expect(paused).not.toBe(completed);
  });

  it("renders an unknown status with the same neutral treatment as the dormant statuses", () => {
    // The fallback IS the archived/inactive look — an unmapped status
    // must read as "dormant/neutral", never accidentally as a live
    // status color.
    const unknown = pillClassName("mystery");
    expect(unknown).toBe(pillClassName("archived"));
    expect(unknown).toBe(pillClassName("inactive"));
    expect(unknown).not.toBe(pillClassName("active"));
  });

  it("hides the decorative color dot from assistive tech", () => {
    const { container } = render(<StatusBadge status="active" label="Active" />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
  });
});
