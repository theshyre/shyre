import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const mockSplit = vi.fn(async (_fd: FormData) => ({
  success: true as const,
}));
vi.mock("@/lib/expenses/actions", () => ({
  splitExpenseAction: (fd: FormData) => mockSplit(fd),
}));

import { SplitExpenseModal } from "./split-expense-modal";

function renderModal(
  props: Partial<React.ComponentProps<typeof SplitExpenseModal>> = {},
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <SplitExpenseModal
      expenseId="e1"
      originalAmount={100}
      originalCurrency="USD"
      originalCategory="software"
      originalNotes="original note"
      onClose={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  mockSplit.mockClear();
});

describe("SplitExpenseModal", () => {
  it("renders a dialog seeded with two split rows", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Split this expense")).toBeInTheDocument();
    expect(screen.getByLabelText("Split 1 amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Split 2 amount")).toBeInTheDocument();
    expect(screen.queryByLabelText("Split 3 amount")).toBeNull();
  });

  it("adds rows via Add row; remove stays disabled at the 2-row minimum", () => {
    renderModal();
    const removeButtons = screen.getAllByRole("button", {
      name: "Remove this row",
    });
    for (const b of removeButtons) expect(b).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Add row/ }));
    expect(screen.getByLabelText("Split 3 amount")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "Remove this row" })
        .some((b) => !(b as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("submits the splits payload and closes on success", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    // Initial halves (50 + 50 = 100) are valid, so confirm is enabled.
    fireEvent.click(screen.getByRole("button", { name: /Save 2 splits/ }));
    await waitFor(() => expect(mockSplit).toHaveBeenCalledTimes(1));
    const fd = mockSplit.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
    const splits = JSON.parse(String(fd?.get("splits"))) as Array<{
      amount: number;
      category: string;
    }>;
    expect(splits).toHaveLength(2);
    expect((splits[0]?.amount ?? 0) + (splits[1]?.amount ?? 0)).toBe(100);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables confirm while the sum does not match the original", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Split 1 amount"), {
      target: { value: "10" },
    });
    expect(
      screen.getByRole("button", { name: /Save 2 splits/ }),
    ).toBeDisabled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
