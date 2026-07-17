import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MarkdownPdf } from "./markdown-pdf";

/** renderToString emits react-pdf host elements (lowercased) with their props,
 *  so we can string-search the rendered tree — same technique as the invoice /
 *  proposal PDF smoke tests. Locks in that markdown parses + maps to primitives,
 *  not pixel layout. */
function render(md: string): string {
  return renderToString(<MarkdownPdf content={md} />);
}

describe("MarkdownPdf", () => {
  it("renders headings, paragraphs, and bold/italic/code inline runs", () => {
    const html = render(
      "# Scope\n\nSome **bold** and *italic* and `code` text.",
    );
    expect(html).toContain("Scope");
    expect(html).toContain("bold");
    expect(html).toContain("italic");
    expect(html).toContain("code");
    // Bold maps to Helvetica-Bold; code maps to Courier.
    expect(html).toContain("Helvetica-Bold");
    expect(html).toContain("Courier");
  });

  it("renders bullet + ordered lists with markers", () => {
    const bullets = render("- alpha\n- beta");
    expect(bullets).toContain("alpha");
    expect(bullets).toContain("beta");
    expect(bullets).toContain("•");

    const ordered = render("1. first\n2. second");
    expect(ordered).toContain("first");
    expect(ordered).toContain("second");
    expect(ordered).toContain("1.");
    expect(ordered).toContain("2.");
  });

  it("renders GFM tables as primitive rows/cells", () => {
    const html = render("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("A");
    expect(html).toContain("B");
    expect(html).toContain("1");
    expect(html).toContain("2");
  });

  it("does NOT emit raw HTML embedded in the source (inert text)", () => {
    const html = render("Hello <script>alert(1)</script> world");
    // The parser keeps it as text; no executable <script> element is produced.
    expect(html).not.toContain("<script>alert");
  });

  it("survives empty content", () => {
    expect(() => render("")).not.toThrow();
  });
});
