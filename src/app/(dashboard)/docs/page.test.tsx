import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Docs hub — previously untested. The Modules section now reads from
 * the shared DOC_TOPICS manifest instead of an inline array (see
 * docs/reference/documentation.md's topic-navigation rules): each
 * card links its title AND a "See all N articles" affordance to the
 * new topic-index route, and surfaces the topic's Quick guide as the
 * card's primary CTA. The rest of the hub (personal links, role
 * browse, reference) is untouched by that migration.
 */

const mockGetUserTeams = vi.fn();
vi.mock("@/lib/team-context", () => ({
  getUserTeams: () => mockGetUserTeams(),
}));

const mockIsSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  isSystemAdmin: () => mockIsSystemAdmin(),
}));

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

import DocsIndexPage from "./page";
import { DOC_TOPICS } from "@/lib/docs/topics";

async function renderPage(): Promise<void> {
  const jsx = await DocsIndexPage();
  render(jsx);
}

beforeEach(() => {
  mockGetUserTeams.mockReset().mockResolvedValue([]);
  mockIsSystemAdmin.mockReset().mockResolvedValue(false);
});

describe("DocsIndexPage — Modules section", () => {
  it("renders one card per DOC_TOPICS topic with its name and blurb", async () => {
    await renderPage();
    for (const topic of DOC_TOPICS) {
      expect(screen.getByRole("heading", { name: topic.name })).toBeInTheDocument();
      expect(screen.getByText(topic.blurb)).toBeInTheDocument();
    }
  });

  it("the card title links to the topic-index route", async () => {
    await renderPage();
    const stint = DOC_TOPICS.find((t) => t.slug === "stint")!;
    expect(
      screen.getByRole("link", { name: new RegExp(`^${stint.name}$`) }),
    ).toHaveAttribute("href", "/docs/topics/stint");
  });

  it("surfaces each topic's Quick guide as the card's primary CTA, in card order", async () => {
    await renderPage();
    const quickLinks = screen.getAllByText("Quick guide");
    // One per topic card, same order as DOC_TOPICS.
    expect(quickLinks).toHaveLength(DOC_TOPICS.length);
    quickLinks.forEach((label, i) => {
      const topic = DOC_TOPICS[i]!;
      const quickGuide = topic.articles[0]!;
      expect(quickGuide.quick, `${topic.slug}: first article is the Quick guide`).toBe(true);
      expect(label.closest("a")).toHaveAttribute("href", quickGuide.href);
    });
  });

  it("every topic's 'See all N articles' links to its own topic index with the right count", async () => {
    await renderPage();
    for (const topic of DOC_TOPICS) {
      const seeAllLinks = screen
        .getAllByText(`See all ${topic.articles.length} articles`)
        .map((el) => el.closest("a"))
        .filter((a): a is HTMLAnchorElement => a !== null);
      expect(
        seeAllLinks.some((a) => a.getAttribute("href") === `/docs/topics/${topic.slug}`),
        `${topic.slug}: expected a "See all ${topic.articles.length} articles" link to /docs/topics/${topic.slug}`,
      ).toBe(true);
    }
  });
});

describe("DocsIndexPage — untouched sections", () => {
  it("still renders the personal 'For you' links and reference section", async () => {
    await renderPage();
    expect(
      screen.getByText("First login to first invoice — the orientation tour."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Architecture" }),
    ).toHaveAttribute("href", "/docs/reference/architecture");
  });

  it("shows owner-only personal links when the user owns a team", async () => {
    mockGetUserTeams.mockResolvedValue([{ role: "owner" }]);
    await renderPage();
    expect(screen.getByText("Teams and roles")).toBeInTheDocument();
  });

  it("shows the sysadmin role-browse card regardless of role", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /System admins/ })).toHaveAttribute(
      "href",
      "/docs/guides/admin",
    );
  });
});
