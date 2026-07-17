import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView", () => {
  it("renders headings, emphasis, and lists as HTML", () => {
    render(
      <MarkdownView content={"## Scope\n\nSome **bold** text.\n\n- one\n- two"} />,
    );
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  it("renders GFM tables", () => {
    render(<MarkdownView content={"| A | B |\n|---|---|\n| 1 | 2 |"} />);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("opens links in a new tab with a safe rel", () => {
    render(<MarkdownView content={"[site](https://example.com)"} />);
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does NOT render embedded raw HTML (no rehype-raw) — the public-page safety guarantee", () => {
    const { container } = render(
      <MarkdownView content={"Hi <img src=x onerror=alert(1)> there"} />,
    );
    // The raw <img> is not injected into the DOM — it's inert text.
    expect(container.querySelector("img")).toBeNull();
  });

  it("neutralizes a javascript: link scheme", () => {
    render(<MarkdownView content={"[x](javascript:alert(1))"} />);
    const link = screen.queryByRole("link", { name: "x" });
    // react-markdown's default url transform strips the dangerous scheme.
    expect(link?.getAttribute("href") ?? "").not.toContain("javascript:");
  });
});
