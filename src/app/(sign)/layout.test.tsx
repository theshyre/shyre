import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SignLayout from "./layout";

describe("SignLayout", () => {
  it("renders its children", () => {
    render(<SignLayout>{<p>doc body</p>}</SignLayout>);
    expect(screen.getByText("doc body")).toBeInTheDocument();
  });

  it("scales the root type up for the sign document (bigger text, same column)", () => {
    const { container } = render(
      <SignLayout>
        <span>x</span>
      </SignLayout>,
    );
    const style = container.querySelector("style");
    expect(style).not.toBeNull();
    // Bumps the root font-size so the rem-based type tokens scale uniformly,
    // and covers both the no-attribute and stored-preference cases.
    // %-based so the visitor's browser default-font-size preference
    // still applies (WCAG 1.4.4) — 125% of the default 16px = 20px.
    expect(style?.innerHTML).toContain("font-size:125%");
    expect(style?.innerHTML).toContain("html[data-text-size]");
  });
});
