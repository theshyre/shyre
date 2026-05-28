import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// Mock the createExpenseAction so the wrapper's render doesn't pull
// the server-action import chain into the test environment.
vi.mock(
  "@/app/(dashboard)/business/[businessId]/expenses/actions",
  () => ({
    createExpenseAction: vi.fn(async () => ({ success: true })),
  }),
);

import { ProjectExpenseForm } from "./project-expense-form";

describe("ProjectExpenseForm", () => {
  it("renders the collapsed 'Add expense' trigger", () => {
    renderWithIntl(
      <ProjectExpenseForm teamId="t1" teamName="Acme" projectId="p1" />,
    );
    expect(
      screen.getByRole("button", { name: /Add expense/i }),
    ).toBeInTheDocument();
  });

  it("hides the project picker when expanded (lockedProjectId path)", () => {
    renderWithIntl(
      <ProjectExpenseForm teamId="t1" teamName="Acme" projectId="p1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add expense/i }));

    // The amount input proves the form expanded; the absence of a
    // project select proves the locked-path took effect.
    expect(screen.getByLabelText(/Amount/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Project$/i)).toBeNull();
  });

  it("submits a hidden project_id pinned to the locked project", () => {
    const { container } = renderWithIntl(
      <ProjectExpenseForm teamId="t1" teamName="Acme" projectId="p1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add expense/i }));

    const hidden = container.querySelector<HTMLInputElement>(
      "input[type=hidden][name=project_id]",
    );
    expect(hidden).not.toBeNull();
    expect(hidden?.value).toBe("p1");
  });

  it("does NOT render the team picker when only one team is in scope", () => {
    renderWithIntl(
      <ProjectExpenseForm teamId="t1" teamName="Acme" projectId="p1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add expense/i }));
    // Team picker shows only when teamOptions.length > 1, and the
    // wrapper hard-codes a single-team list.
    expect(screen.queryByLabelText(/^Team$/i)).toBeNull();
  });
});
