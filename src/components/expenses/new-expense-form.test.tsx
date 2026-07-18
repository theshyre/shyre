import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl, testMessages } from "@/test/intl";

vi.mock("@/lib/expenses/actions", () => ({
  createExpenseAction: vi.fn(async () => ({ success: true })),
}));

import { NewExpenseForm } from "./new-expense-form";

const oneTeam = [{ id: "t1", name: "Acme" }];
const twoTeams = [
  { id: "t1", name: "Acme" },
  { id: "t2", name: "Globex" },
];
const projects = [
  { id: "p1", name: "Redesign", team_id: "t1" },
  { id: "p2", name: "Migration", team_id: "t2" },
];

function open(): void {
  fireEvent.click(screen.getByRole("button", { name: /Add expense/i }));
}

describe("NewExpenseForm", () => {
  it("starts collapsed with the Add trigger and its N shortcut hint", () => {
    renderWithIntl(
      <NewExpenseForm defaultTeamId="t1" teamOptions={oneTeam} projects={[]} />,
    );
    const trigger = screen.getByRole("button", { name: /Add expense/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector("kbd")?.textContent).toBe("N");
  });

  it("shows the secondary action only while collapsed", () => {
    renderWithIntl(
      <NewExpenseForm
        defaultTeamId="t1"
        teamOptions={oneTeam}
        projects={[]}
        secondaryAction={<span data-testid="secondary">Import CSV</span>}
      />,
    );
    expect(screen.getByTestId("secondary")).toBeInTheDocument();
    open();
    expect(screen.queryByTestId("secondary")).toBeNull();
  });

  it("renders no team picker for a single team, and one for multiple teams", () => {
    const { unmount } = renderWithIntl(
      <NewExpenseForm defaultTeamId="t1" teamOptions={oneTeam} projects={[]} />,
    );
    open();
    expect(screen.queryByLabelText(/^Team/)).toBeNull();
    unmount();

    renderWithIntl(
      <NewExpenseForm
        defaultTeamId="t1"
        teamOptions={twoTeams}
        projects={[]}
      />,
    );
    open();
    expect(screen.getByLabelText(/^Team/)).toBeInTheDocument();
  });

  it("scopes the project dropdown to the selected team", () => {
    renderWithIntl(
      <NewExpenseForm
        defaultTeamId="t1"
        teamOptions={twoTeams}
        projects={projects}
      />,
    );
    open();
    const projectSelect = screen.getByLabelText(/^Project$/);
    expect(projectSelect).toHaveTextContent("Redesign");
    expect(projectSelect).not.toHaveTextContent("Migration");

    fireEvent.change(screen.getByLabelText(/^Team/), {
      target: { value: "t2" },
    });
    expect(projectSelect).toHaveTextContent("Migration");
    expect(projectSelect).not.toHaveTextContent("Redesign");
  });

  it("locks the project via a hidden field when lockedProjectId is set", () => {
    const { container } = renderWithIntl(
      <NewExpenseForm
        defaultTeamId="t1"
        teamOptions={oneTeam}
        projects={projects}
        lockedProjectId="p1"
      />,
    );
    open();
    expect(screen.queryByLabelText(/^Project$/)).toBeNull();
    const hidden = container.querySelector<HTMLInputElement>(
      "input[type=hidden][name=project_id]",
    );
    expect(hidden?.value).toBe("p1");
  });

  it("shows the per-category hint after a category is picked", () => {
    renderWithIntl(
      <NewExpenseForm defaultTeamId="t1" teamOptions={oneTeam} projects={[]} />,
    );
    open();
    const help = testMessages.expenses.categoryHelp.software;
    expect(screen.queryByText(help.description)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Category/), {
      target: { value: "software" },
    });
    expect(screen.getByText(help.description)).toBeInTheDocument();
  });

  it("offers a vendor datalist only when suggestions exist", () => {
    const { container, unmount } = renderWithIntl(
      <NewExpenseForm
        defaultTeamId="t1"
        teamOptions={oneTeam}
        projects={[]}
        vendorOptions={["AWS", "GitHub"]}
      />,
    );
    open();
    const withList = container.querySelector("datalist");
    expect(withList).not.toBeNull();
    expect(withList?.querySelectorAll("option")).toHaveLength(2);
    unmount();

    const { container: bare } = renderWithIntl(
      <NewExpenseForm defaultTeamId="t1" teamOptions={oneTeam} projects={[]} />,
    );
    open();
    expect(bare.querySelector("datalist")).toBeNull();
  });
});
