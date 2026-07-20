import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Article route — reads a real markdown file off disk and renders it.
 * Previously untested. Extended here for the prev/next-within-topic
 * footer (docs/reference/documentation.md's topic-navigation rules):
 * derived from the shared DOC_TOPICS manifest, first article omits
 * Previous, last omits Next, middle articles get both, and articles
 * outside any topic (reference pages, etc.) render no nav at all.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const docs = (await import("@/lib/i18n/locales/en/docs.json"))
      .default as Record<string, unknown>;
    return (key: string): string => {
      const path = [...namespace.split(".").slice(1), ...key.split(".")];
      let cur: unknown = docs;
      for (const part of path) {
        cur = (cur as Record<string, unknown>)[part];
      }
      return String(cur);
    };
  },
}));

vi.mock("@/components/LinkPendingSpinner", () => ({
  LinkPendingSpinner: () => <span data-testid="link-pending-spinner" />,
}));

import DocPage, { generateMetadata } from "./page";

async function renderDoc(slug: string[]): Promise<void> {
  const jsx = await DocPage({ params: Promise.resolve({ slug }) });
  render(jsx);
}

describe("DocPage", () => {
  it("renders breadcrumbs and the markdown body for a real guide", async () => {
    await renderDoc(["guides", "features", "categories"]);
    expect(screen.getByRole("navigation", { name: "Breadcrumbs" })).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
  });

  it("calls notFound for a slug with no matching file", async () => {
    await expect(
      DocPage({ params: Promise.resolve({ slug: ["nope", "not-a-real-doc"] }) }),
    ).rejects.toThrow();
  });

  it("rejects path traversal in slug segments", async () => {
    await expect(
      DocPage({ params: Promise.resolve({ slug: ["..", "..", "etc", "passwd"] }) }),
    ).rejects.toThrow();
  });

  it("the first article in a topic (Stint quick guide) shows Next but no Previous", async () => {
    await renderDoc(["guides", "features", "stint-quickstart"]);
    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Next.*Time tracking/s }),
    ).toHaveAttribute("href", "/docs/guides/features/time-tracking");
  });

  it("the last article in a topic (Imports) shows Previous but no Next", async () => {
    await renderDoc(["guides", "features", "imports"]);
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
    const prevLink = screen.getByRole("link", {
      name: /Previous.*Sub-project rollup filter/s,
    });
    expect(prevLink).toHaveAttribute(
      "href",
      "/docs/guides/features/sub-project-rollup-filter",
    );
  });

  it("a middle article (Categories) shows both Previous and Next", async () => {
    await renderDoc(["guides", "features", "categories"]);
    expect(
      screen.getByRole("link", { name: /Previous.*Time tracking/s }),
    ).toHaveAttribute("href", "/docs/guides/features/time-tracking");
    expect(
      screen.getByRole("link", { name: /Next.*Templates/s }),
    ).toHaveAttribute("href", "/docs/guides/features/templates");
  });

  it("a doc outside any topic (reference/architecture) renders no prev/next nav", async () => {
    await renderDoc(["reference", "architecture"]);
    expect(
      screen.queryByRole("navigation", { name: "Article navigation" }),
    ).not.toBeInTheDocument();
  });

  it("generateMetadata prettifies the last slug segment into a title", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: ["guides", "features", "time-tracking"] }),
    });
    expect(metadata.title).toBe("Time tracking · Docs");
  });
});
