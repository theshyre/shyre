import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldError } from "./FieldError";

describe("FieldError", () => {
  it("returns null when error is undefined", () => {
    const { container } = render(<FieldError error={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when error is null", () => {
    const { container } = render(<FieldError error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when error is the empty string (falsy)", () => {
    const { container } = render(<FieldError error="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the message inside a role=alert with aria-live=assertive", () => {
    const { container } = render(<FieldError error="Name is required" />);
    const p = container.querySelector("p[role='alert']");
    expect(p).not.toBeNull();
    expect(p?.getAttribute("aria-live")).toBe("assertive");
    expect(p?.textContent).toContain("Name is required");
  });

  it("includes an AlertCircle icon paired with the text (≥2 channels per CLAUDE.md)", () => {
    const { container } = render(<FieldError error="X" />);
    // Lucide renders an svg.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("applies the provided id so inputs can aria-describedby it", () => {
    render(<FieldError error="X" id="my-error-id" />);
    const p = screen.getByRole("alert");
    expect(p.id).toBe("my-error-id");
  });
});
