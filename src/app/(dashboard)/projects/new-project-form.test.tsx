import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const createProject = vi.fn();
vi.mock("./actions", () => ({
  createProjectAction: (fd: FormData) => createProject(fd),
}));

import {
  AddProjectTrigger,
  NewProjectForm,
  NewProjectFormProvider,
} from "./new-project-form";

const teams = [
  { id: "t-1", name: "Team One", slug: "team-one", role: "owner" as const },
];

function renderHeaderAndForm(): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <NewProjectFormProvider>
      <AddProjectTrigger />
      <NewProjectForm customers={[]} teams={teams} categorySets={[]} />
    </NewProjectFormProvider>,
  );
}

beforeEach(() => {
  createProject.mockReset();
});

describe("AddProjectTrigger + NewProjectForm (header-cluster primary action)", () => {
  it("renders the trigger with icon, label, and visible kbd N; form starts closed", () => {
    renderHeaderAndForm();
    const trigger = screen.getByRole("button", { name: /Add Project/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.querySelector("kbd")).toHaveTextContent("N");
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(document.getElementById("new-project-form")).toBeNull();
  });

  it("opens the inline-expansion form on click and closes it again on toggle", () => {
    renderHeaderAndForm();
    const trigger = screen.getByRole("button", { name: /Add Project/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "new-project-form");
    expect(document.getElementById("new-project-form")).not.toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("new-project-form")).toBeNull();
  });

  it("opens the form on the N keyboard shortcut", () => {
    renderHeaderAndForm();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(document.getElementById("new-project-form")).not.toBeNull();
  });

  it("closes the form via the Cancel button", () => {
    renderHeaderAndForm();
    fireEvent.click(screen.getByRole("button", { name: /Add Project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.getElementById("new-project-form")).toBeNull();
  });

  it("throws when rendered outside the provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(() => renderWithIntl(<AddProjectTrigger />)).toThrow(
      /NewProjectFormProvider/,
    );
    consoleError.mockRestore();
  });
});
