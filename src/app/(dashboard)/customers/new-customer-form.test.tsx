import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  createCustomerAction: vi.fn(async (_fd: FormData) => {}),
}));

import {
  NewCustomerForm,
  NewCustomerProvider,
  NewCustomerTrigger,
} from "./new-customer-form";
import type { TeamListItem } from "@/lib/team-context";

const teams: TeamListItem[] = [
  { id: "t1", name: "Team One", slug: "team-one", role: "owner" },
];

function renderSection(): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <NewCustomerProvider>
      <NewCustomerTrigger />
      <NewCustomerForm teams={teams} defaultTeamId="t1" />
    </NewCustomerProvider>,
  );
}

describe("NewCustomerTrigger + NewCustomerForm", () => {
  it("starts collapsed: trigger with visible kbd N, no form", () => {
    renderSection();
    const trigger = screen.getByRole("button", { name: /Add Customer/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.querySelector("kbd")?.textContent).toBe("N");
    expect(screen.queryByLabelText(/Name \*/)).toBeNull();
  });

  it("clicking the trigger expands the inline form below and toggles it closed again", () => {
    renderSection();
    const trigger = screen.getByRole("button", { name: /Add Customer/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute(
      "aria-controls",
      "new-customer-form-panel",
    );
    expect(screen.getByLabelText(/Name \*/)).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/Name \*/)).toBeNull();
  });

  it("opens on the N keyboard shortcut", () => {
    renderSection();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(
      screen.getByRole("button", { name: /Add Customer/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Name \*/)).toBeInTheDocument();
  });

  it("does not hijack N typed into an input", () => {
    renderWithIntl(
      <NewCustomerProvider>
        <input aria-label="Elsewhere" type="text" />
        <NewCustomerTrigger />
        <NewCustomerForm teams={teams} defaultTeamId="t1" />
      </NewCustomerProvider>,
    );
    const input = screen.getByLabelText("Elsewhere");
    input.focus();
    fireEvent.keyDown(input, { key: "n" });
    expect(
      screen.getByRole("button", { name: /Add Customer/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("Cancel closes the form", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Add Customer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/Name \*/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Add Customer/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
