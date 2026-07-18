import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("@/lib/expenses/actions", () => ({
  updateExpenseFieldAction: vi.fn(async () => ({ success: true })),
}));

import { ExpenseExpandedRow } from "./expense-expanded-row";

const expense = {
  id: "e1",
  team_id: "t1",
  user_id: "u1",
  incurred_on: "2026-05-01",
  amount: 42.5,
  currency: "usd",
  vendor: "GitHub",
  external_reference: null,
  category: "software",
  description: "CI minutes",
  notes: null,
  project_id: "p1",
  billable: true,
};

function renderExpanded(
  props: Partial<React.ComponentProps<typeof ExpenseExpandedRow>> = {},
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <table>
      <tbody>
        <ExpenseExpandedRow
          expense={expense}
          projects={[{ id: "p1", name: "Redesign", team_id: "t1" }]}
          columnCount={9}
          canEdit
          onClose={() => {}}
          {...props}
        />
      </tbody>
    </table>,
  );
}

describe("ExpenseExpandedRow", () => {
  it("spans the full parent row width via colSpan", () => {
    const { container } = renderExpanded({ columnCount: 7 });
    expect(container.querySelector("td")?.colSpan).toBe(7);
  });

  it("renders the editable field cluster (date, amount, category, project, vendor)", () => {
    renderExpanded();
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    // Amount display pairs value + uppercased currency (2 channels).
    expect(screen.getByText(/42\.50\s+USD/)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderExpanded({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
