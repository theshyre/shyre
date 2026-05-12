import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TeamListItem } from "@/lib/team-context";
import { TeamSelector, updateLastOrg } from "./TeamSelector";

function team(id: string, name: string): TeamListItem {
  return { id, name, slug: name.toLowerCase(), role: "owner" };
}

beforeEach(() => {
  localStorage.clear();
});

describe("TeamSelector", () => {
  it("returns null when teams list is empty", () => {
    const { container } = render(<TeamSelector teams={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("single-team mode renders a disabled input + a hidden team_id input", () => {
    const { container } = render(
      <TeamSelector teams={[team("t-1", "Acme")]} />,
    );
    const visible = container.querySelector("input[type='text']") as
      | HTMLInputElement
      | null;
    expect(visible).not.toBeNull();
    expect(visible?.value).toBe("Acme");
    expect(visible?.disabled).toBe(true);
    const hidden = container.querySelector(
      "input[type='hidden'][name='team_id']",
    ) as HTMLInputElement | null;
    expect(hidden?.value).toBe("t-1");
  });

  it("multi-team mode renders a select with one option per team", () => {
    render(
      <TeamSelector teams={[team("t-1", "Acme"), team("t-2", "Beta")]} />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.name).toBe("team_id");
    expect(select.options).toHaveLength(2);
    expect(select.options[0]?.value).toBe("t-1");
    expect(select.options[1]?.value).toBe("t-2");
  });

  it("defaults the selection to the explicit defaultTeamId when valid", () => {
    render(
      <TeamSelector
        teams={[team("t-1", "Acme"), team("t-2", "Beta")]}
        defaultTeamId="t-2"
      />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "t-2",
    );
  });

  it("falls back to last-used (localStorage) when no defaultTeamId", () => {
    localStorage.setItem("stint-last-team", "t-2");
    render(
      <TeamSelector teams={[team("t-1", "Acme"), team("t-2", "Beta")]} />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "t-2",
    );
  });

  it("falls back to first team when neither defaultTeamId nor a valid localStorage value exist", () => {
    render(
      <TeamSelector teams={[team("t-1", "Acme"), team("t-2", "Beta")]} />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "t-1",
    );
  });

  it("ignores stale localStorage values that no longer match any team", () => {
    localStorage.setItem("stint-last-team", "t-gone");
    render(
      <TeamSelector teams={[team("t-1", "Acme"), team("t-2", "Beta")]} />,
    );
    // Falls back to first team.
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "t-1",
    );
  });

  it("changing the dropdown writes the new selection to localStorage", () => {
    render(
      <TeamSelector teams={[team("t-1", "Acme"), team("t-2", "Beta")]} />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "t-2" },
    });
    expect(localStorage.getItem("stint-last-team")).toBe("t-2");
  });

  it("uses custom label when provided", () => {
    render(
      <TeamSelector
        teams={[team("t-1", "Acme")]}
        label="Choose a workspace"
      />,
    );
    expect(screen.getByText("Choose a workspace")).toBeInTheDocument();
  });
});

describe("updateLastOrg helper", () => {
  it("writes the team id to the same localStorage key the selector reads", () => {
    updateLastOrg("t-9");
    expect(localStorage.getItem("stint-last-team")).toBe("t-9");
  });
});
