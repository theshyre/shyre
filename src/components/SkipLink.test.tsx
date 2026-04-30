import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkipLink } from "./SkipLink";

describe("SkipLink", () => {
  it("renders an anchor pointing at the given target id", () => {
    render(<SkipLink targetId="main-content" />);
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link.getAttribute("href")).toBe("#main-content");
  });

  it("uses the sr-only class so it's visually hidden until focused", () => {
    render(<SkipLink targetId="main" />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("sr-only");
    // The focus pseudo-class promotes it back. We can't assert :focus
    // styles directly in jsdom, so this just guards the class.
    expect(link.className).toContain("focus:not-sr-only");
  });

  it("accepts a custom label", () => {
    render(<SkipLink targetId="main" label="Jump to content" />);
    expect(
      screen.getByRole("link", { name: "Jump to content" }),
    ).toBeTruthy();
  });
});
