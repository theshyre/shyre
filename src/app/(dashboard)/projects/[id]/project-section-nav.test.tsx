import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// Mock usePathname so each test controls which tab is "active."
let currentPathname = "/projects/p-1";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

import { ProjectSectionNav } from "./project-section-nav";

function setPath(p: string): void {
  currentPathname = p;
}

describe("ProjectSectionNav", () => {
  it("renders every visible section as a Link", () => {
    setPath("/projects/p-1");
    renderWithIntl(
      <ProjectSectionNav projectId="p-1" callerIsAdmin={false} />,
    );
    // Non-admin: 4 sections (history hidden).
    expect(screen.getByRole("link", { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Time/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Expenses/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument();
  });

  it("hides the History link for non-admins", () => {
    setPath("/projects/p-1");
    renderWithIntl(
      <ProjectSectionNav projectId="p-1" callerIsAdmin={false} />,
    );
    expect(screen.queryByRole("link", { name: /History/i })).toBeNull();
  });

  it("shows the History link for admins", () => {
    setPath("/projects/p-1");
    renderWithIntl(<ProjectSectionNav projectId="p-1" callerIsAdmin />);
    expect(screen.getByRole("link", { name: /History/i })).toBeInTheDocument();
  });

  it("marks Overview as the current page on the bare /projects/[id] path", () => {
    setPath("/projects/p-1");
    renderWithIntl(<ProjectSectionNav projectId="p-1" callerIsAdmin />);
    const overview = screen.getByRole("link", { name: /Overview/i });
    expect(overview.getAttribute("aria-current")).toBe("page");
    // The other links must NOT carry aria-current.
    expect(
      screen.getByRole("link", { name: /Time/i }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks Time as the current page on the /time sub-route (and not Overview)", () => {
    setPath("/projects/p-1/time");
    renderWithIntl(<ProjectSectionNav projectId="p-1" callerIsAdmin />);
    expect(
      screen.getByRole("link", { name: /Time/i }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: /Overview/i }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks Expenses as the current page on the /expenses sub-route", () => {
    setPath("/projects/p-1/expenses");
    renderWithIntl(<ProjectSectionNav projectId="p-1" callerIsAdmin />);
    expect(
      screen
        .getByRole("link", { name: /Expenses/i })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("uses exact pathname match so Overview doesn't light up on /time", () => {
    // Regression guard: an earlier draft used pathname.startsWith
    // for every section — Overview would light up everywhere because
    // every sub-route starts with /projects/[id]. Each section now
    // provides its own exact-match predicate.
    setPath("/projects/p-1/settings");
    renderWithIntl(<ProjectSectionNav projectId="p-1" callerIsAdmin />);
    expect(
      screen
        .getByRole("link", { name: /Overview/i })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /Settings/i })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("scopes hrefs to the given projectId", () => {
    setPath("/projects/p-7");
    renderWithIntl(<ProjectSectionNav projectId="p-7" callerIsAdmin />);
    expect(
      screen.getByRole("link", { name: /Overview/i }).getAttribute("href"),
    ).toBe("/projects/p-7");
    expect(
      screen.getByRole("link", { name: /Time/i }).getAttribute("href"),
    ).toBe("/projects/p-7/time");
    expect(
      screen.getByRole("link", { name: /Expenses/i }).getAttribute("href"),
    ).toBe("/projects/p-7/expenses");
  });

  it("wraps the section list in a labelled <nav>", () => {
    setPath("/projects/p-1");
    renderWithIntl(<ProjectSectionNav projectId="p-1" callerIsAdmin />);
    const nav = screen.getByRole("navigation", { name: /Project sections/i });
    expect(nav).toBeInTheDocument();
  });
});
