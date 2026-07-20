import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Previously untested. Audit batch D moved NewTeamForm behind a
 * top-right header trigger (list-pages.md rule 2), converted the
 * empty state to the bordered-card + icon-circle treatment (rule 6),
 * and added LinkPendingSpinner to each team card link (navigation-
 * feedback mandate).
 */

const mockGetUserTeams = vi.fn();
vi.mock("@/lib/team-context", () => ({
  getUserTeams: () => mockGetUserTeams(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const common = (await import("@/lib/i18n/locales/en/common.json"))
      .default as Record<string, unknown>;
    return (key: string): string => {
      const path = [...namespace.split(".").slice(1), ...key.split(".")];
      let cur: unknown = common;
      for (const part of path) {
        cur = (cur as Record<string, unknown>)[part];
      }
      return String(cur);
    };
  },
}));

vi.mock("./new-team-form", () => ({
  NewTeamFormProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AddTeamTrigger: () => <button type="button">Create Team</button>,
  NewTeamForm: () => null,
}));

vi.mock("@/components/LinkPendingSpinner", () => ({
  LinkPendingSpinner: () => <span data-testid="link-pending-spinner" />,
}));

import OrganizationsPage from "./page";

async function renderPage(): Promise<void> {
  const jsx = await OrganizationsPage();
  render(jsx);
}

beforeEach(() => {
  mockGetUserTeams.mockReset();
});

describe("OrganizationsPage", () => {
  it("renders the bordered-card + icon-circle empty state when the user has no teams", async () => {
    mockGetUserTeams.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("No teams yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Create a team to invite colleagues/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Aa/)).toBeNull();
  });

  it("renders a card per team with the role badge and a nav-feedback spinner", async () => {
    mockGetUserTeams.mockResolvedValue([
      { id: "t-1", name: "Acme", slug: "acme", role: "owner" },
      { id: "t-2", name: "Beta Co", slug: "beta-co", role: "member" },
    ]);
    await renderPage();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Beta Co")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getAllByTestId("link-pending-spinner")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Acme/ })).toHaveAttribute(
      "href",
      "/teams/t-1",
    );
  });

  it("the primary trigger sits in the header, not gating the whole page behind it", async () => {
    mockGetUserTeams.mockResolvedValue([
      { id: "t-1", name: "Acme", slug: "acme", role: "owner" },
    ]);
    await renderPage();
    expect(
      screen.getByRole("button", { name: "Create Team" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
