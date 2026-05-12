import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TeamListItem } from "@/lib/team-context";

/**
 * TeamFilter is a URL-driven filter pill. Hidden when 1 team,
 * dropdown when N>1. The URL param it writes is `?org=…` (legacy
 * name; comment in source explains why).
 */

const pushMock = vi.fn();
const searchParamsToString = vi.fn(() => "");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/customers",
  useSearchParams: () => ({
    toString: () => searchParamsToString(),
  }),
}));

import { TeamFilter } from "./TeamFilter";

function team(id: string, name: string): TeamListItem {
  return { id, name, slug: name.toLowerCase(), role: "owner" };
}

beforeEach(() => {
  pushMock.mockReset();
  searchParamsToString.mockReset().mockReturnValue("");
});

describe("TeamFilter", () => {
  it("renders a single static pill when there's only one team (no dropdown)", () => {
    const { container } = render(
      <TeamFilter teams={[team("t-1", "Acme")]} selectedTeamId={null} />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // No button → no dropdown trigger.
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders 'All' on the trigger when no team is selected (>1 team)", () => {
    render(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument();
  });

  it("renders the selected team's name on the trigger", () => {
    render(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId="t-2"
      />,
    );
    expect(screen.getByRole("button", { name: /Beta/ })).toBeInTheDocument();
  });

  it("clicking the trigger reveals the dropdown with All + every team", () => {
    render(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    // After click, two more buttons in the dropdown (All + Acme + Beta — 3 total with trigger).
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    // Both team names present in the dropdown.
    expect(
      screen.getAllByRole("button").some((b) => b.textContent === "Acme"),
    ).toBe(true);
    expect(
      screen.getAllByRole("button").some((b) => b.textContent === "Beta"),
    ).toBe(true);
  });

  it("selecting a team pushes ?org=<id> to the URL (legacy param name)", () => {
    render(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    const acmeButton = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "Acme");
    fireEvent.click(acmeButton!);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]?.[0]).toBe("/customers?org=t-1");
  });

  it("selecting 'All' clears the ?org param", () => {
    render(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId="t-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Acme/ }));
    // The dropdown's "All" sits separately from the trigger.
    const allButtons = screen.getAllByRole("button", { name: /All/ });
    // The first match is the trigger; click the dropdown item (last).
    fireEvent.click(allButtons[allButtons.length - 1]!);
    expect(pushMock).toHaveBeenCalledTimes(1);
    // URL retains pathname; ?org omitted.
    expect(pushMock.mock.calls[0]?.[0]).toMatch(/\/customers\?/);
    expect(pushMock.mock.calls[0]?.[0]).not.toContain("org=");
  });

  it("preserves other URL params when toggling the team filter", () => {
    searchParamsToString.mockReturnValue("status=active&sort=name");
    render(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    const acme = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "Acme");
    fireEvent.click(acme!);
    const url = pushMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("status=active");
    expect(url).toContain("sort=name");
    expect(url).toContain("org=t-1");
  });
});
