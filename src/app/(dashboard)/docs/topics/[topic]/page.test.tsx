import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Topic-index page — the "see everything in this topic" view added
 * for docs/reference/documentation.md's topic-navigation rules. Reads
 * DOC_TOPICS (the shared manifest also consumed by the hub and by
 * article prev/next) and renders every article in manifest order,
 * with the Quick guide called out distinctly and first.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const docs = (await import("@/lib/i18n/locales/en/docs.json"))
      .default as Record<string, unknown>;
    return (key: string, vars?: Record<string, unknown>): string => {
      const path = [...namespace.split(".").slice(1), ...key.split(".")];
      let cur: unknown = docs;
      for (const part of path) {
        cur = (cur as Record<string, unknown>)[part];
      }
      let str = String(cur);
      // Minimal ICU plural handling for the {count, plural, ...} keys
      // used here — good enough for a render assertion.
      const pluralMatch = /\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}/.exec(str);
      if (pluralMatch) {
        const count = Number(vars?.count ?? 0);
        const form = count === 1 ? pluralMatch[1] : pluralMatch[2];
        str = str.replace(pluralMatch[0], String(form).replace("#", String(count)));
      }
      return str;
    };
  },
}));

vi.mock("@/components/LinkPendingSpinner", () => ({
  LinkPendingSpinner: () => <span data-testid="link-pending-spinner" />,
}));

import DocTopicIndexPage, { generateMetadata, generateStaticParams } from "./page";
import { DOC_TOPICS } from "@/lib/docs/topics";

async function renderTopic(topic: string): Promise<void> {
  const jsx = await DocTopicIndexPage({ params: Promise.resolve({ topic }) });
  render(jsx);
}

describe("DocTopicIndexPage", () => {
  it("renders the topic header, blurb, and article count", async () => {
    await renderTopic("stint");
    expect(screen.getByRole("heading", { name: "Stint" })).toBeInTheDocument();
    expect(
      screen.getByText("Time tracking. The daily-driver module."),
    ).toBeInTheDocument();
    expect(screen.getByText("8 articles")).toBeInTheDocument();
  });

  it("calls out the Quick guide distinctly and first, badge + topic name + blurb", async () => {
    await renderTopic("stint");
    const stint = DOC_TOPICS.find((t) => t.slug === "stint");
    const quickGuide = stint?.articles[0];
    expect(quickGuide?.quick).toBe(true);

    expect(screen.getByText("Quick guide")).toBeInTheDocument();
    expect(screen.getByText(quickGuide!.blurb)).toBeInTheDocument();
    const quickLink = screen.getByRole("link", { name: /Quick guide.*Stint/s });
    expect(quickLink).toHaveAttribute("href", quickGuide!.href);
  });

  it("renders every remaining article in manifest order with its blurb", async () => {
    await renderTopic("stint");
    const stint = DOC_TOPICS.find((t) => t.slug === "stint");
    const rest = stint?.articles.slice(1) ?? [];
    const links = screen.getAllByRole("link").filter((el) =>
      rest.some((a) => el.getAttribute("href") === a.href),
    );
    expect(links).toHaveLength(rest.length);
    rest.forEach((article, i) => {
      expect(links[i]).toHaveAttribute("href", article.href);
      expect(screen.getByText(article.blurb)).toBeInTheDocument();
    });
  });

  it("renders a Back to Documentation link to the hub", async () => {
    await renderTopic("customers");
    expect(screen.getByRole("link", { name: /Back to Documentation/ })).toHaveAttribute(
      "href",
      "/docs",
    );
  });

  it("a two-article topic (Reports) renders its single non-quick article", async () => {
    await renderTopic("reports");
    const reports = DOC_TOPICS.find((t) => t.slug === "reports");
    expect(reports?.articles).toHaveLength(2);
    expect(screen.getByText(reports!.articles[1]!.blurb)).toBeInTheDocument();
  });

  it("throws notFound for an unknown topic slug", async () => {
    await expect(
      DocTopicIndexPage({ params: Promise.resolve({ topic: "does-not-exist" }) }),
    ).rejects.toThrow();
  });

  it("generateMetadata resolves the topic name for a known slug", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ topic: "invoicing" }),
    });
    expect(metadata.title).toBe("Invoicing · Docs");
  });

  it("generateMetadata falls back to 'Docs' for an unknown slug", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ topic: "nope" }),
    });
    expect(metadata.title).toBe("Docs");
  });

  it("generateStaticParams returns every topic slug", async () => {
    const params = await generateStaticParams();
    expect(params.map((p) => p.topic).sort()).toEqual(
      DOC_TOPICS.map((t) => t.slug).sort(),
    );
  });
});
