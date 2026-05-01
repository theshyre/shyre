import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { Breadcrumbs } from "./Breadcrumbs";

const pathnameRef: { current: string } = { current: "/" };
const router = {
  push: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
};
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => router,
}));

vi.mock("@/lib/breadcrumbs/resolvers", () => ({
  resolveSegmentLabel: vi.fn(async (key: string, id: string) => {
    if (key === "businessName" && id === "abc-123") return "Malcom IO LLC";
    if (key === "businessName" && id === "permission-denied") return null;
    if (key === "teamName" && id === "team-1") return "Engineering";
    if (key === "invoiceNumber" && id === "inv-141") return "141";
    if (key === "customerName" && id === "cust-1") return "EyeReg Consulting, Inc.";
    if (key === "projectName" && id === "proj-1") return "AVDR eClinical";
    return null;
  }),
}));

beforeEach(() => {
  pathnameRef.current = "/";
  router.push.mockClear();
  router.back.mockClear();
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

  it("renders an invoice detail trail with the resolved invoice number", async () => {
    pathnameRef.current = "/invoices/inv-141";
    renderWithIntl(<Breadcrumbs />);
    // Static segments first.
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invoices" })).toBeTruthy();
    // Async-resolved invoice number.
    await waitFor(() => {
      const leaf = screen.getByText("141");
      expect(leaf.getAttribute("aria-current")).toBe("page");
    });
  });

  it("renders a customer detail trail (Work › Customers › <name>)", async () => {
    pathnameRef.current = "/customers/cust-1";
    renderWithIntl(<Breadcrumbs />);
    await waitFor(() => {
      const leaf = screen.getByText("EyeReg Consulting, Inc.");
      expect(leaf.getAttribute("aria-current")).toBe("page");
    });
  });

  describe("[ shortcut", () => {
    it("navigates to the last navigable parent on `[`", () => {
      pathnameRef.current = "/invoices/inv-141";
      renderWithIntl(<Breadcrumbs />);
      fireEvent.keyDown(window, { key: "[" });
      expect(router.push).toHaveBeenCalledWith("/invoices");
    });

    it("falls back to router.back() on routes without a registered trail", () => {
      pathnameRef.current = "/not-a-real-page";
      renderWithIntl(<Breadcrumbs />);
      fireEvent.keyDown(window, { key: "[" });
      expect(router.back).toHaveBeenCalled();
    });

    it("ignores `[` when an input is focused", () => {
      pathnameRef.current = "/invoices/inv-141";
      renderWithIntl(<Breadcrumbs />);
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      fireEvent.keyDown(input, { key: "[" });
      expect(router.push).not.toHaveBeenCalled();
      input.remove();
    });

    it("ignores `[` with a modifier (lets browser Cmd+[ pass through)", () => {
      pathnameRef.current = "/invoices/inv-141";
      renderWithIntl(<Breadcrumbs />);
      fireEvent.keyDown(window, { key: "[", metaKey: true });
      expect(router.push).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "[", ctrlKey: true });
      expect(router.push).not.toHaveBeenCalled();
    });

    it("skips structural-only parents (null href) and uses the next link up", () => {
      // /invoices/[id] trail = [Work (null href), Invoices (link),
      // 141 (leaf)]. Up-one-level should land on Invoices, NOT on
      // Work (which has no destination).
      pathnameRef.current = "/invoices/inv-141";
      renderWithIntl(<Breadcrumbs />);
      fireEvent.keyDown(window, { key: "[" });
      expect(router.push).toHaveBeenCalledWith("/invoices");
      expect(router.push).not.toHaveBeenCalledWith(null);
    });
  });
});
