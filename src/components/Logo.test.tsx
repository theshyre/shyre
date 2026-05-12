import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("renders an svg at the default 32px square", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("accepts a custom size", () => {
    const { container } = render(<Logo size={64} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("64");
    expect(svg?.getAttribute("height")).toBe("64");
  });

  it("passes className through to the svg", () => {
    const { container } = render(<Logo className="text-accent" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toBe(
      "text-accent",
    );
  });

  it("is aria-hidden (decorative — paired with brand text elsewhere)", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("uses currentColor so the caller controls fill/stroke via text-* utilities", () => {
    const { container } = render(<Logo />);
    const paths = container.querySelectorAll("path");
    // At least one path uses currentColor for fill or stroke.
    const hasCurrentColor = Array.from(paths).some(
      (p) =>
        p.getAttribute("fill") === "currentColor" ||
        p.getAttribute("stroke") === "currentColor",
    );
    expect(hasCurrentColor).toBe(true);
  });
});
