import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { RecentProjectsChips } from "./recent-projects-chips";

const projects = [
  { id: "p1", name: "Alpha", github_repo: null, team_id: "o1", category_set_id: null, require_timestamps: true },
  { id: "p2", name: "Beta", github_repo: null, team_id: "o1", category_set_id: null, require_timestamps: true },
];

describe("RecentProjectsChips", () => {
  it("renders a chip per project", () => {
    renderWithIntl(
      <RecentProjectsChips projects={projects} selectedId="" onPick={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("calls onPick when a chip is clicked", () => {
    const onPick = vi.fn();
    renderWithIntl(
      <RecentProjectsChips projects={projects} selectedId="" onPick={onPick} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onPick).toHaveBeenCalledWith("p2");
  });

  it("highlights the selected chip", () => {
    renderWithIntl(
      <RecentProjectsChips projects={projects} selectedId="p1" onPick={() => {}} />,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    expect(alpha.className).toMatch(/accent/);
    expect(beta.className).not.toMatch(/accent/);
  });

  it("renders a Recent heading", () => {
    renderWithIntl(
      <RecentProjectsChips projects={projects} selectedId="" onPick={() => {}} />,
    );
    expect(screen.getByText(/recent/i)).toBeInTheDocument();
  });
});
