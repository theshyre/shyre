import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/intl";
import {
  HubCustomerList,
  HubMemberList,
  HubProjectList,
  type HubCustomerItem,
  type HubMemberItem,
  type HubProjectItem,
} from "./hub-sections";

function customer(overrides: Partial<HubCustomerItem> = {}): HubCustomerItem {
  return {
    id: "c1",
    name: "Acme Corp",
    defaultRate: null,
    logoUrl: null,
    inactiveAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<HubProjectItem> = {}): HubProjectItem {
  return {
    id: "p1",
    name: "Website",
    status: "active",
    isInternal: false,
    parentProjectId: null,
    customer: { id: "c1", name: "Acme Corp", logo_url: null },
    ...overrides,
  };
}

function member(overrides: Partial<HubMemberItem> = {}): HubMemberItem {
  return {
    id: "m1",
    userId: "u1",
    role: "member",
    displayName: "Jordan Patel",
    avatarUrl: null,
    isShell: false,
    ...overrides,
  };
}

describe("HubCustomerList", () => {
  it("links each row to the customer detail page with the name as the visible label", () => {
    render(<HubCustomerList customers={[customer()]} />);
    const link = screen.getByRole("link", { name: /Acme Corp/ });
    expect(link).toHaveAttribute("href", "/customers/c1");
  });

  it("shows the Inactive lifecycle badge only for dormant customers", () => {
    render(
      <HubCustomerList
        customers={[
          customer({ id: "c1", name: "Active Co" }),
          customer({
            id: "c2",
            name: "Dormant LLC",
            inactiveAt: "2026-01-01T00:00:00+00:00",
          }),
        ]}
      />,
    );
    const dormantRow = screen.getByRole("link", { name: /Dormant LLC/ });
    expect(within(dormantRow).getByText("Inactive")).toBeInTheDocument();
    const activeRow = screen.getByRole("link", { name: /Active Co/ });
    expect(within(activeRow).queryByText("Inactive")).not.toBeInTheDocument();
  });

  it("formats the default rate as currency per hour and omits it when unset", () => {
    render(
      <HubCustomerList
        customers={[
          customer({ id: "c1", name: "Rated", defaultRate: 150 }),
          customer({ id: "c2", name: "Unrated" }),
        ]}
      />,
    );
    const rated = screen.getByRole("link", { name: /Rated/ });
    expect(within(rated).getByText("$150.00/hr")).toBeInTheDocument();
    const unrated = screen.getByRole("link", { name: /Unrated/ });
    expect(within(unrated).queryByText(/\/hr/)).not.toBeInTheDocument();
  });
});

describe("HubProjectList", () => {
  it("nests a sub-project directly under its parent with the relationship announced to screen readers", () => {
    render(
      <HubProjectList
        projects={[
          project({ id: "child", name: "Phase 2", parentProjectId: "parent" }),
          project({ id: "other", name: "Other Project" }),
          project({ id: "parent", name: "Website Redesign" }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    const names = items.map((li) => li.textContent ?? "");
    const parentIdx = names.findIndex((t) => t.includes("Website Redesign"));
    const childIdx = names.findIndex((t) => t.includes("Phase 2"));
    expect(childIdx).toBe(parentIdx + 1);
    expect(
      screen.getByText("Sub-project of Website Redesign"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sub-project of Website Redesign").className,
    ).toContain("sr-only");
  });

  it("renders an orphaned sub-project as a top-level row instead of dropping it", () => {
    render(
      <HubProjectList
        projects={[
          project({
            id: "orphan",
            name: "Orphan Task",
            parentProjectId: "not-in-list",
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Orphan Task/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sub-project of/)).not.toBeInTheDocument();
  });

  it("shows each project's status badge", () => {
    render(
      <HubProjectList
        projects={[
          project({ id: "p1", name: "Live", status: "active" }),
          project({ id: "p2", name: "OnHold", status: "paused" }),
        ]}
      />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("renders the Internal chip for internal projects instead of a customer name", () => {
    render(
      <HubProjectList
        projects={[
          project({
            id: "int",
            name: "Ops",
            isInternal: true,
            customer: null,
          }),
        ]}
      />,
    );
    // The pill next to the name carries the label (the building-glyph
    // chip is the second channel); trailing customer attribution is
    // intentionally absent for internal rows.
    expect(screen.getAllByText("Internal")).toHaveLength(1);
  });

  it("labels a customer-less external project 'No customer', never 'Internal'", () => {
    render(
      <HubProjectList
        projects={[
          project({
            id: "pending",
            name: "Unassigned Work",
            isInternal: false,
            customer: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("No customer")).toBeInTheDocument();
    expect(screen.queryByText("Internal")).not.toBeInTheDocument();
  });

  it("links each row to the project detail page", () => {
    render(<HubProjectList projects={[project()]} />);
    expect(screen.getByRole("link", { name: /Website/ })).toHaveAttribute(
      "href",
      "/projects/p1",
    );
  });

  it("applies the preview limit after nesting so a rendered child keeps its rendered parent", () => {
    render(
      <HubProjectList
        limit={2}
        projects={[
          project({ id: "a", name: "Alpha" }),
          project({ id: "a-kid", name: "Alpha Kid", parentProjectId: "a" }),
          project({ id: "b", name: "Beta" }),
        ]}
      />,
    );
    // Parent + its child fill the preview; Beta falls off the end.
    expect(screen.getByRole("link", { name: /Alpha Kid/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Beta/ }),
    ).not.toBeInTheDocument();
  });
});

describe("HubMemberList", () => {
  it("renders display name with a translated role badge", () => {
    render(
      <HubMemberList
        members={[
          member({ id: "m1", userId: "u1", role: "owner", displayName: "Ana" }),
          member({ id: "m2", userId: "u2", role: "admin", displayName: "Bo" }),
          member({ id: "m3", userId: "u3", role: "member", displayName: "Cy" }),
        ]}
      />,
    );
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("falls back to raw role text for unknown roles instead of throwing", () => {
    render(<HubMemberList members={[member({ role: "billing" })]} />);
    expect(screen.getByText("billing")).toBeInTheDocument();
  });

  it("renders a deterministic preset avatar as an aria-hidden identity mark", () => {
    const { container } = render(<HubMemberList members={[member()]} />);
    // The visible text is the accessible name; the avatar tile is
    // wrapped aria-hidden so the name isn't announced twice.
    expect(container.textContent).toContain("Jordan Patel");
    const tile = container.querySelector("[aria-label='Jordan Patel']");
    expect(tile).not.toBeNull();
    expect(tile?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("marks shell members with the neutral Imported chip, not raw '(shell)' text", () => {
    render(
      <HubMemberList
        members={[member({ displayName: "Harvest Import", isShell: true })]}
      />,
    );
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.queryByText(/\(shell\)/)).not.toBeInTheDocument();
  });

  it("makes the Imported chip keyboard-focusable so its tooltip is reachable", () => {
    render(
      <HubMemberList
        members={[member({ displayName: "Harvest Import", isShell: true })]}
      />,
    );
    expect(screen.getByText("Imported")).toHaveAttribute("tabindex", "0");
  });

  it("does not render the Imported chip for regular members", () => {
    render(<HubMemberList members={[member()]} />);
    expect(screen.queryByText("Imported")).not.toBeInTheDocument();
  });

  it("uses the Unnamed fallback when a member has no display name", () => {
    render(<HubMemberList members={[member({ displayName: null })]} />);
    expect(screen.getByText("Unnamed")).toBeInTheDocument();
  });
});
