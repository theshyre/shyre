import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

const mockDelete = vi.fn(async (_fd: FormData) => ({
  success: true as const,
}));
vi.mock("@/lib/expenses/actions", () => ({
  updateExpenseFieldAction: vi.fn(async () => ({ success: true })),
  deleteExpenseAction: (fd: FormData) => mockDelete(fd),
  restoreExpenseAction: vi.fn(async () => ({ success: true })),
  splitExpenseAction: vi.fn(async () => ({ success: true })),
}));

import { ExpenseRow } from "./expense-row";

type ExpenseProp = React.ComponentProps<typeof ExpenseRow>["expense"];

const baseExpense: ExpenseProp = {
  id: "e1",
  team_id: "t1",
  user_id: "u1",
  incurred_on: "2026-05-01",
  amount: 42.5,
  currency: "USD",
  vendor: "GitHub",
  external_reference: null,
  category: "software",
  description: "CI minutes",
  notes: null,
  project_id: "p1",
  billable: true,
  is_sample: false,
  projects: { id: "p1", name: "Redesign" },
  invoiced: false,
  invoice_id: null,
  invoice_number: null,
};

const author = { userId: "u1", displayName: "Dana", avatarUrl: null };
const projects = [{ id: "p1", name: "Redesign", team_id: "t1" }];

function renderRow(
  overrides: Partial<ExpenseProp> = {},
  props: Partial<React.ComponentProps<typeof ExpenseRow>> = {},
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <ToastProvider>
      <table>
        <tbody>
          <ExpenseRow
            expense={{ ...baseExpense, ...overrides }}
            author={author}
            projects={projects}
            vendorOptions={[]}
            teamName={null}
            columnCount={9}
            canEdit
            selected={false}
            onToggleSelect={() => {}}
            isExpanded={false}
            onToggleExpand={() => {}}
            hideSelection
            {...props}
          />
        </tbody>
      </table>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockDelete.mockClear();
});

describe("ExpenseRow", () => {
  it("renders date, amount, vendor, project, and the category chip", () => {
    renderRow();
    expect(screen.getByText("May 1, 2026")).toBeInTheDocument();
    expect(screen.getByText(/42\.50/)).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Redesign")).toBeInTheDocument();
    expect(screen.getByText("Software")).toBeInTheDocument();
  });

  it("hides the bulk-select checkbox when hideSelection is set, shows it otherwise", () => {
    const { unmount } = renderRow();
    expect(screen.queryByRole("checkbox")).toBeNull();
    unmount();

    const onToggleSelect = vi.fn();
    renderRow({}, { hideSelection: false, onToggleSelect });
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith("e1");
  });

  it("reports expansion through onToggleExpand", () => {
    const onToggleExpand = vi.fn();
    renderRow({}, { onToggleExpand });
    fireEvent.click(
      screen.getByRole("button", { name: /Expand details for GitHub/ }),
    );
    expect(onToggleExpand).toHaveBeenCalledWith("e1");
  });

  it("collapses actions to an Invoiced chip (link) on an invoiced row", () => {
    renderRow({
      invoiced: true,
      invoice_id: "inv-1",
      invoice_number: "#INV-7",
    });
    const chip = screen.getByRole("link", {
      name: /Locked — on invoice #INV-7/,
    });
    expect(chip).toHaveAttribute("href", "/invoices/inv-1");
    // Delete + split are suppressed — the DB trigger would refuse.
    expect(
      screen.queryByRole("button", { name: /Delete GitHub expense/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Split GitHub/ }),
    ).toBeNull();
  });

  it("hides delete and split affordances when the viewer cannot edit", () => {
    renderRow({}, { canEdit: false });
    expect(
      screen.queryByRole("button", { name: /Delete GitHub expense/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Split GitHub/ }),
    ).toBeNull();
  });

  it("goes through inline confirm before calling deleteExpenseAction", async () => {
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: /Delete GitHub expense/ }),
    );
    // First click never deletes — it swaps to [Confirm][Cancel].
    expect(mockDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    const fd = mockDelete.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
  });

  it("cancel backs out of the delete confirm without deleting", () => {
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: /Delete GitHub expense/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Delete GitHub expense/ }),
    ).toBeInTheDocument();
  });

  it("opens the split modal from the split action", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: /Split GitHub/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Split this expense")).toBeInTheDocument();
  });
});
