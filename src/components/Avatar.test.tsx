import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders the initial when no avatarUrl", () => {
    render(<Avatar avatarUrl={null} displayName="Marcus" />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("uppercases the initial", () => {
    render(<Avatar avatarUrl={null} displayName="alice" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders '?' for empty display name", () => {
    render(<Avatar avatarUrl={null} displayName="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders a preset with matching bg color", () => {
    const { container } = render(
      <Avatar avatarUrl="preset:violet" displayName="Marcus" />,
    );
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.backgroundColor).toBe("rgb(139, 92, 246)"); // #8b5cf6
    expect(el.textContent).toBe("M");
  });

  it("falls back to initial for unknown preset key", () => {
    render(<Avatar avatarUrl="preset:notreal" displayName="Marcus" />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("renders an <img> for https URL", () => {
    render(
      <Avatar
        avatarUrl="https://example.com/a.png"
        displayName="Marcus"
      />,
    );
    const img = screen.getByRole("img", { name: "Marcus" }) as HTMLImageElement;
    expect(img.src).toBe("https://example.com/a.png");
  });

  it("falls back to initial for non-http, non-preset strings", () => {
    render(<Avatar avatarUrl="gibberish" displayName="Marcus" />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });
});
