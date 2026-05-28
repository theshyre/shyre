import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// Mock the actions module up front so the row's imports don't pull
// in the full server-action chain. The row only needs to know that
// the action handlers are callable functions; the per-call success
// payload is asserted via the mock's call history.
// vi.hoisted so the mock factory (also hoisted) can reference these
// fns at hoist time — a plain `const` would be in its TDZ when the
// factory runs.
const mocks = vi.hoisted(() => ({
  deleteAction: vi.fn(async (..._args: unknown[]) => ({ success: true })),
  restoreAction: vi.fn(async (..._args: unknown[]) => ({ success: true })),
}));
const { deleteAction, restoreAction } = mocks;
vi.mock(
  "@/app/(dashboard)/business/[businessId]/expenses/actions",
  () => ({
    deleteExpenseAction: mocks.deleteAction,
    restoreExpenseAction: mocks.restoreAction,
  }),
);

import { ProjectExpenseRow } from "./project-expense-row";
import { ToastProvider } from "@/components/Toast";

const baseExpense = {
  id: "exp-1",
  incurred_on: "2026-04-15",
  amount: 49.99,
  currency: "USD",
  vendor: "Linear",
  category: "software",
  billable: true,
  invoiced: false,
  invoiceId: null,
  invoiceNumber: null,
} as const;

function renderRow(
  overrides?: Partial<React.ComponentProps<typeof ProjectExpenseRow>>,
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <ToastProvider>
      <table>
        <tbody>
          <ProjectExpenseRow
            expense={{ ...baseExpense }}
            author={{
              userId: "u-1",
              displayName: "Alex Author",
              avatarUrl: null,
            }}
            canEdit
            businessId="biz-1"
            projectId="proj-1"
            {...overrides}
          />
        </tbody>
      </table>
    </ToastProvider>,
  );
}

describe("ProjectExpenseRow", () => {
  it("renders amount, vendor, category, and author", () => {
    renderRow();
    expect(screen.getByText("$49.99")).toBeInTheDocument();
    expect(screen.getByText("Linear")).toBeInTheDocument();
    // category 'software' resolves through expenses.categories.software.
    expect(screen.getByText("Software")).toBeInTheDocument();
    expect(screen.getByText("Alex Author")).toBeInTheDocument();
  });

  it("shows the Billable badge when expense.billable is true", () => {
    renderRow();
    // There are two matches: the visible badge text and the tooltip
    // label. Either is acceptable evidence that the badge is on.
    const badges = screen.getAllByText(/Billable/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it("shows the Not billable caption when expense.billable is false", () => {
    renderRow({ expense: { ...baseExpense, billable: false } });
    expect(screen.getByText(/Not billable/i)).toBeInTheDocument();
  });

  it("deep-links to /business/<id>/expenses?project=<projectId>", () => {
    renderRow();
    const link = screen.getByRole("link", {
      name: /Open Linear on the Expenses page/i,
    });
    expect(link.getAttribute("href")).toBe(
      "/business/biz-1/expenses?project=proj-1",
    );
  });

  it("hides the delete button when canEdit is false", () => {
    renderRow({ canEdit: false });
    expect(screen.queryByLabelText(/Delete Linear/i)).toBeNull();
  });

  it("requires a confirm click before invoking deleteExpenseAction", async () => {
    deleteAction.mockClear();
    renderRow();

    fireEvent.click(screen.getByLabelText(/Delete Linear/i));
    // Confirm button now visible — the original Trash icon is replaced.
    const confirm = screen.getByLabelText(/Confirm delete/i);
    expect(deleteAction).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => {
      expect(deleteAction).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back to a category label when vendor is missing", () => {
    renderRow({ expense: { ...baseExpense, vendor: null } });
    // The delete button's aria label uses category fallback when
    // vendor is null — verifies the ariaIdent branch.
    expect(screen.getByLabelText(/Delete Software/i)).toBeInTheDocument();
  });

  it("renders 'Unknown user' when an author profile has no displayName", () => {
    renderRow({
      author: { userId: "u-1", displayName: null, avatarUrl: null },
    });
    // A UUID slice would be read aloud as gibberish — fallback to a
    // localized "Unknown user" string keeps the row scannable for AT.
    expect(screen.getByText(/Unknown user/i)).toBeInTheDocument();
  });

  it("renders an Invoiced chip linking to the invoice when expense.invoiced is true", () => {
    renderRow({
      expense: {
        ...baseExpense,
        invoiced: true,
        invoiceId: "inv-77",
        invoiceNumber: "INV-0077",
      },
    });
    const chip = screen.getByRole("link", { name: /Locked.*INV-0077/i });
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute("href")).toBe("/invoices/inv-77");
    // Edit deep-link and trash should both be suppressed — the row
    // is locked.
    expect(
      screen.queryByLabelText(/Open Linear on the Expenses page/i),
    ).toBeNull();
    expect(screen.queryByLabelText(/Delete Linear/i)).toBeNull();
  });

  it("falls back to 'Invoiced' label when invoiceNumber is missing", () => {
    // Defensive — the page-level join could resolve invoice_id but
    // miss invoice_number for an in-flight migration scenario. The
    // chip still appears, just without the number suffix.
    renderRow({
      expense: {
        ...baseExpense,
        invoiced: true,
        invoiceId: "inv-77",
        invoiceNumber: null,
      },
    });
    const chip = screen.getByRole("link", { name: /Locked.*on invoice/i });
    expect(chip).toBeInTheDocument();
  });

  it("triggers restoreExpenseAction when the Undo toast action fires", async () => {
    deleteAction.mockClear();
    restoreAction.mockClear();
    renderRow();

    fireEvent.click(screen.getByLabelText(/Delete Linear/i));
    fireEvent.click(screen.getByLabelText(/Confirm delete/i));
    await waitFor(() => {
      expect(deleteAction).toHaveBeenCalledTimes(1);
    });

    // The Undo toast renders as a button labelled "Undo" — fire it
    // and verify the restore action ran with the correct id.
    const undo = await screen.findByRole("button", { name: /Undo/i });
    fireEvent.click(undo);
    await waitFor(() => {
      expect(restoreAction).toHaveBeenCalledTimes(1);
    });
    const fd = restoreAction.mock.calls[0]?.[0];
    expect(fd).toBeInstanceOf(FormData);
    expect((fd as FormData).get("id")).toBe("exp-1");
  });
});
