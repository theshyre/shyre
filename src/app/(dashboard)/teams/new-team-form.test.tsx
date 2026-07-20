import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import {
  AddTeamTrigger,
  NewTeamForm,
  NewTeamFormProvider,
} from "./new-team-form";

/**
 * Audit batch D: split the single NewTeamForm component into a
 * Provider + header-cluster AddTeamTrigger + inline-expansion
 * NewTeamForm (mirrors projects/new-project-form.tsx) so the trigger
 * can live in the page's Row 1 header per list-pages.md rule 2,
 * while the expanded form keeps rendering below it.
 */

const createMock = vi.fn();
vi.mock("./actions", () => ({
  createTeamAction: (fd: FormData) => createMock(fd),
}));

function renderWrapped(): void {
  renderWithIntl(
    <NewTeamFormProvider>
      <AddTeamTrigger />
      <NewTeamForm />
    </NewTeamFormProvider>,
  );
}

beforeEach(() => createMock.mockReset());

describe("NewTeamForm / AddTeamTrigger", () => {
  it("the form is absent until the trigger is clicked", () => {
    renderWrapped();
    expect(screen.queryByLabelText(/Team name/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Create Team/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking the trigger expands the form and shows the name field", () => {
    renderWrapped();
    const trigger = screen.getByRole("button", { name: /Create Team/ });
    fireEvent.click(trigger);
    expect(screen.getByLabelText(/Team name/)).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "new-team-form");
  });

  it("Cancel collapses the form again", () => {
    renderWrapped();
    fireEvent.click(screen.getByRole("button", { name: /Create Team/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/Team name/)).toBeNull();
  });

  it("submitting creates the team and collapses the form on success", async () => {
    createMock.mockResolvedValue({ success: true });
    renderWrapped();
    fireEvent.click(screen.getByRole("button", { name: /Create Team/ }));
    fireEvent.change(screen.getByLabelText(/Team name/), {
      target: { value: "Acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const fd = createMock.mock.calls[0]![0] as FormData;
    expect(fd.get("team_name")).toBe("Acme");
    await waitFor(() => expect(screen.queryByLabelText(/Team name/)).toBeNull());
  });

  it("NewTeamForm throws outside the provider (fails loud, not silently blank)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderWithIntl(<NewTeamForm />)).toThrow(
      /must render inside <NewTeamFormProvider>/,
    );
    spy.mockRestore();
  });
});
