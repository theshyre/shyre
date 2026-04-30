import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { Breadcrumbs } from "./Breadcrumbs";

const pathnameRef: { current: string } = { current: "/" };
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

vi.mock("@/lib/breadcrumbs/resolvers", () => ({
  resolveSegmentLabel: vi.fn(async (key: string, id: string) => {
    if (key === "businessName" && id === "abc-123") return "Malcom IO LLC";
    if (key === "businessName" && id === "permission-denied") return null;
    if (key === "teamName" && id === "team-1") return "Engineering";
    return null;
  }),
}));

beforeEach(() => {
  pathnameRef.current = "/";
});

describe("Breadcrumbs", () => {
  it("renders nothing on the dashboard root (single-segment trail)", () => {
    pathnameRef.current = "/";
    const { container } = renderWithIntl(<Breadcrumbs />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on an unregistered path", () => {
    pathnameRef.current = "/not-a-real-page";
    const { container } = renderWithIntl(<Breadcrumbs />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Setup › Import for /import (last segment is aria-current)", () => {
    pathnameRef.current = "/import";
    renderWithIntl(<Breadcrumbs />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeTruthy();
    // Setup is structural (no link)
    expect(screen.getByText("Setup")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Setup" })).toBeNull();
    // Import is the leaf — text only with aria-current
    const leaf = screen.getByText("Import");
    expect(leaf.getAttribute("aria-current")).toBe("page");
  });

  it("renders separators with aria-hidden so screen readers don't read them", () => {
    pathnameRef.current = "/import";
    renderWithIntl(<Breadcrumbs />);
    const separators = screen.getAllByText("›");
    expect(separators.length).toBeGreaterThan(0);
    for (const sep of separators) {
      expect(sep.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("resolves a dynamic segment label asynchronously", async () => {
    pathnameRef.current = "/business/abc-123";
    renderWithIntl(<Breadcrumbs />);
    // Initial render: placeholder
    expect(screen.getByText("—")).toBeTruthy();
    // After resolver: the business name shows up
    await waitFor(() => {
      expect(screen.getByText("Malcom IO LLC")).toBeTruthy();
    });
  });

  it("falls back to '(unavailable)' when resolver returns null", async () => {
    pathnameRef.current = "/business/permission-denied";
    renderWithIntl(<Breadcrumbs />);
    await waitFor(() => {
      expect(screen.getByText("(unavailable)")).toBeTruthy();
    });
  });

  it("non-leaf segments with href render as links", () => {
    pathnameRef.current = "/business/abc-123/people";
    renderWithIntl(<Breadcrumbs />);
    // "Business" is a non-leaf with href="/business" — should be a link
    const businessLink = screen.getByRole("link", { name: "Business" });
    expect(businessLink.getAttribute("href")).toBe("/business");
  });

  it("substitutes params into hrefs of intermediate segments", async () => {
    pathnameRef.current = "/business/abc-123/people";
    renderWithIntl(<Breadcrumbs />);
    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Malcom IO LLC" });
      expect(link.getAttribute("href")).toBe("/business/abc-123");
    });
  });
});
