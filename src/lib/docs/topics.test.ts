import { describe, it, expect } from "vitest";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DOC_TOPICS, findArticleContext, getTopicBySlug } from "./topics";

/**
 * Manifest integrity — see docs/reference/documentation.md → "Topic
 * navigation & quick guides — MANDATORY". `DOC_TOPICS` is the single
 * source of truth for the hub, the topic-index route, and article
 * prev/next; these tests are what keeps it honest.
 */

async function docFileExists(href: string): Promise<boolean> {
  // Every manifest href is an app route into the docs slug renderer:
  // "/docs/guides/features/foo" -> docs/guides/features/foo.md (or
  // a README.md if it were a directory index — not used by the
  // manifest today, but resolved the same way for parity with
  // src/app/(dashboard)/docs/[...slug]/page.tsx's readDoc()).
  const rel = href.replace(/^\/docs\//, "");
  const base = resolve(process.cwd(), "docs", rel);
  try {
    const s = await stat(`${base}.md`);
    return s.isFile();
  } catch {
    try {
      const s = await stat(resolve(base, "README.md"));
      return s.isFile();
    } catch {
      return false;
    }
  }
}

describe("DOC_TOPICS manifest integrity", () => {
  it("every topic has a non-empty slug, name, and blurb", () => {
    for (const topic of DOC_TOPICS) {
      expect(topic.slug.length).toBeGreaterThan(0);
      expect(topic.name.length).toBeGreaterThan(0);
      expect(topic.blurb.length).toBeGreaterThan(0);
      expect(topic.articles.length).toBeGreaterThan(0);
    }
  });

  it("topic slugs are unique", () => {
    const slugs = DOC_TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every article has a non-empty title and blurb", () => {
    for (const topic of DOC_TOPICS) {
      for (const article of topic.articles) {
        expect(article.title.length, `${topic.slug}: ${article.href} title`).toBeGreaterThan(0);
        expect(article.blurb.length, `${topic.slug}: ${article.href} blurb`).toBeGreaterThan(0);
      }
    }
  });

  it("every article href resolves to a real file under docs/", async () => {
    const missing: string[] = [];
    for (const topic of DOC_TOPICS) {
      for (const article of topic.articles) {
        const exists = await docFileExists(article.href);
        if (!exists) missing.push(`${topic.slug}: ${article.href}`);
      }
    }
    expect(missing, `broken manifest hrefs:\n${missing.join("\n")}`).toEqual([]);
  });

  it("the first article of every topic is its Quick guide, and no other article is marked quick", () => {
    for (const topic of DOC_TOPICS) {
      const firstArticle = topic.articles[0];
      expect(firstArticle?.quick, `${topic.slug}: first article must be quick:true`).toBe(true);
      const quickCount = topic.articles.filter((a) => a.quick).length;
      expect(quickCount, `${topic.slug}: exactly one quick guide`).toBe(1);
    }
  });

  it("no duplicate article hrefs across the whole manifest", () => {
    const hrefs = DOC_TOPICS.flatMap((t) => t.articles.map((a) => a.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("getTopicBySlug", () => {
  it("finds a topic by slug", () => {
    expect(getTopicBySlug("stint")?.name).toBe("Stint");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getTopicBySlug("does-not-exist")).toBeUndefined();
  });
});

describe("findArticleContext", () => {
  it("returns null for an href not present in any topic", () => {
    expect(findArticleContext("/docs/guides/getting-started")).toBeNull();
  });

  it("the first article in a topic has no prev but has a next", () => {
    const stint = getTopicBySlug("stint");
    const first = stint?.articles[0];
    expect(first).toBeDefined();
    const ctx = findArticleContext(first!.href);
    expect(ctx?.prev).toBeNull();
    expect(ctx?.next?.href).toBe(stint?.articles[1]?.href);
    expect(ctx?.topic.slug).toBe("stint");
    expect(ctx?.index).toBe(0);
  });

  it("the last article in a topic has a prev but no next", () => {
    const stint = getTopicBySlug("stint");
    const articles = stint?.articles ?? [];
    const last = articles[articles.length - 1];
    expect(last).toBeDefined();
    const ctx = findArticleContext(last!.href);
    expect(ctx?.next).toBeNull();
    expect(ctx?.prev?.href).toBe(articles[articles.length - 2]?.href);
  });

  it("a middle article has both a prev and a next matching manifest order", () => {
    const stint = getTopicBySlug("stint");
    const articles = stint?.articles ?? [];
    // Stint has 8 articles; index 3 is comfortably in the middle.
    const middle = articles[3];
    expect(middle).toBeDefined();
    const ctx = findArticleContext(middle!.href);
    expect(ctx?.prev?.href).toBe(articles[2]?.href);
    expect(ctx?.next?.href).toBe(articles[4]?.href);
    expect(ctx?.index).toBe(3);
  });

  it("a two-article topic: first has next-only, second has prev-only", () => {
    const reports = getTopicBySlug("reports");
    const articles = reports?.articles ?? [];
    expect(articles).toHaveLength(2);
    const firstCtx = findArticleContext(articles[0]!.href);
    expect(firstCtx?.prev).toBeNull();
    expect(firstCtx?.next?.href).toBe(articles[1]?.href);
    const secondCtx = findArticleContext(articles[1]!.href);
    expect(secondCtx?.prev?.href).toBe(articles[0]?.href);
    expect(secondCtx?.next).toBeNull();
  });
});
