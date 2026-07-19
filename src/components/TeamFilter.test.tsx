import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import type { TeamListItem } from "@/lib/team-context";

/**
 * TeamFilter is a URL-driven filter pill on the shared <FilterChip>
 * scaffold. Hidden when 1 team, dropdown when N>1. The URL param it
 * writes is `?org=…` (legacy name; comment in source explains why).
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
    const { container } = renderWithIntl(
      <TeamFilter teams={[team("t-1", "Acme")]} selectedTeamId={null} />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // No button → no dropdown trigger.
    expect(container.querySelector("button")).toBeNull();
  });

  it("exposes 'Team: All' as the trigger name when no team is selected (>1 team)", () => {
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Team: All" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("exposes the selected team's name on the trigger", () => {
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId="t-2"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Team: Beta" }),
    ).toBeInTheDocument();
  });

  it("opens a listbox with All + every team; the selected one gets aria-selected + check icon", () => {
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId="t-2"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Team: Beta" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("listbox", { name: "Filter by team" }),
    ).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["All", "Acme", "Beta"]);
    const selected = screen.getByRole("option", { name: "Beta" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected.querySelector("svg.lucide-circle-check-big")).not.toBeNull();
    expect(
      screen.getByRole("option", { name: "Acme" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("selecting a team pushes ?org=<id> (legacy param name) and returns focus to the trigger", () => {
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Team: All" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Acme" }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]?.[0]).toBe("/customers?org=t-1");
    expect(document.activeElement).toBe(trigger);
  });

  it("selecting 'All' clears the ?org param", () => {
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId="t-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Team: Acme" }));
    fireEvent.click(screen.getByRole("option", { name: "All" }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    // URL retains pathname; ?org omitted.
    expect(pushMock.mock.calls[0]?.[0]).toMatch(/\/customers\?/);
    expect(pushMock.mock.calls[0]?.[0]).not.toContain("org=");
  });

  it("preserves other URL params when toggling the team filter", () => {
    searchParamsToString.mockReturnValue("status=active&sort=name");
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Team: All" }));
    fireEvent.click(screen.getByRole("option", { name: "Acme" }));
    const url = pushMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("status=active");
    expect(url).toContain("sort=name");
    expect(url).toContain("org=t-1");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    renderWithIntl(
      <TeamFilter
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        selectedTeamId={null}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Team: All" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
