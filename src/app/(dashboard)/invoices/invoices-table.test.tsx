import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/invoices",
  useSearchParams: () => new URLSearchParams(),
}));

const toastPush = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ push: toastPush }),
}));

const bulkAction = vi.fn();
vi.mock("./actions", () => ({
  bulkUpdateInvoiceStatusAction: (fd: FormData) => bulkAction(fd),
}));

import { InvoicesTable, type InvoiceRow } from "./invoices-table";

const TODAY = "2026-07-18";

function invoice(
  id: string,
  number: string,
  status: string,
  overrides: Partial<InvoiceRow> = {},
): InvoiceRow {
  return {
    id,
    invoice_number: number,
    team_id: "t-1",
    status,
    issued_date: "2026-07-01",
    due_date: "2026-08-01",
    total: 100,
    currency: "USD",
    imported_from: null,
    customers: { id: "c-1", name: "Acme", logo_url: null },
    ...overrides,
  };
}

function renderTable(
  invoices: InvoiceRow[],
  { filtersActive = false }: { filtersActive?: boolean } = {},
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <>
      <input type="text" aria-label="Outside text field" />
      <InvoicesTable
        invoices={invoices}
        totalCount={invoices.length}
        teamNameById={new Map([["t-1", "Acme Team"]])}
        today={TODAY}
        importedTooltip="Imported from Harvest"
        filtersActive={filtersActive}
      />
    </>,
  );
}

beforeEach(() => {
  mockPush.mockReset();
  toastPush.mockReset();
  bulkAction.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InvoicesTable selection", () => {
  it("names each row checkbox after its invoice", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    expect(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    ).toBeInTheDocument();
  });

  it("clears the selection on Escape pressed from a checkbox (inputs without text-editing semantics)", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    const row = screen.getByRole("checkbox", { name: "Select invoice INV-001" });
    fireEvent.click(row);
    expect(row).toBeChecked();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(row).not.toBeChecked();
  });

  it("does NOT clear the selection on Escape from a text-editing control", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    const row = screen.getByRole("checkbox", { name: "Select invoice INV-001" });
    fireEvent.click(row);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Outside text field" }), {
      key: "Escape",
    });
    expect(row).toBeChecked();
  });

  it("offers a visible Clear button that drops the selection", () => {
    renderTable([
      invoice("i-1", "INV-001", "sent"),
      invoice("i-2", "INV-002", "sent"),
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    ).not.toBeChecked();
    expect(screen.getByText("Select rows to mark paid in bulk")).toBeInTheDocument();
  });
});

describe("InvoicesTable mark-paid confirm flow", () => {
  it("arms an inline [Confirm][Cancel] instead of firing immediately", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    expect(bulkAction).not.toHaveBeenCalled();
    expect(screen.getByText("Mark 1 invoice paid?")).toBeInTheDocument();
  });

  it("fires the bulk action with the selected ids only on Confirm", async () => {
    bulkAction.mockResolvedValue(undefined);
    renderTable([
      invoice("i-1", "INV-001", "sent"),
      invoice("i-2", "INV-002", "sent"),
    ]);
    // Both masters (strip + thead) carry the same accessible name —
    // click the strip one.
    const masters = screen.getAllByRole("checkbox", {
      name: "Select all invoices",
    });
    expect(masters).toHaveLength(2);
    fireEvent.click(masters[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(bulkAction).toHaveBeenCalledTimes(1));
    const fd = bulkAction.mock.calls[0]?.[0] as FormData;
    expect(fd.getAll("id").sort()).toEqual(["i-1", "i-2"]);
    expect(fd.get("status")).toBe("paid");
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success" }),
      ),
    );
  });

  it("Cancel collapses the confirm without firing and keeps the selection", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    const row = screen.getByRole("checkbox", { name: "Select invoice INV-001" });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bulkAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Mark 1 invoice paid?")).not.toBeInTheDocument();
    expect(row).toBeChecked();
  });

  it("Escape collapses the armed confirm WITHOUT also clearing the selection", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    const row = screen.getByRole("checkbox", { name: "Select invoice INV-001" });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Mark 1 invoice paid?")).not.toBeInTheDocument();
    // The confirm was the more specific overlay — selection survives.
    expect(row).toBeChecked();
  });

  it("surfaces an error toast when the action rejects", async () => {
    bulkAction.mockRejectedValue(new Error("nope"));
    renderTable([invoice("i-1", "INV-001", "sent")]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "error", message: "nope" }),
      ),
    );
  });
});

describe("InvoicesTable ineligible mark-paid (aria-disabled, never disabled)", () => {
  it("keeps the button focusable with aria-disabled and a guard in the handler", () => {
    renderTable([invoice("i-1", "INV-001", "draft")]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    const btn = screen.getByRole("button", { name: "Mark 1 paid" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(bulkAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Mark 1 invoice paid?")).not.toBeInTheDocument();
  });

  it("enables when every selected invoice is sent or effectively overdue", () => {
    renderTable([
      invoice("i-1", "INV-001", "sent"),
      // due date in the past → effective status overdue.
      invoice("i-2", "INV-002", "sent", { due_date: "2026-01-01" }),
    ]);
    const master = screen.getAllByRole("checkbox", {
      name: "Select all invoices",
    })[0] as HTMLElement;
    fireEvent.click(master);
    expect(
      screen.getByRole("button", { name: "Mark 2 paid" }),
    ).toHaveAttribute("aria-disabled", "false");
  });
});

describe("InvoicesTable live region", () => {
  it("announces the result count, then 'N selected' (debounced) on selection", () => {
    vi.useFakeTimers();
    renderTable([
      invoice("i-1", "INV-001", "sent"),
      invoice("i-2", "INV-002", "sent"),
    ]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 invoices shown");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    // Debounced — not announced immediately.
    expect(screen.getByRole("status")).toHaveTextContent("2 invoices shown");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 invoice selected");
  });

  it("keeps the live region present on the first-run empty state", () => {
    vi.useFakeTimers();
    renderTable([]);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status")).toHaveTextContent("No invoices yet");
    expect(
      screen.getByRole("heading", { name: "No invoices yet" }),
    ).toBeInTheDocument();
  });
});

describe("InvoicesTable empty states", () => {
  it("shows onboarding copy only when no filters are active", () => {
    renderTable([]);
    expect(
      screen.getByRole("heading", { name: "No invoices yet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No invoices match the current filters"),
    ).not.toBeInTheDocument();
  });

  it("shows a no-matches state (not onboarding copy) when filters are active", () => {
    vi.useFakeTimers();
    renderTable([], { filtersActive: true });
    expect(
      screen.getByRole("heading", {
        name: "No invoices match the current filters",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No invoices yet")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No invoices match the current filters",
    );
  });
});

describe("InvoicesTable confirm-flow focus management", () => {
  it("moves focus to Confirm when arming and back to the trigger on Cancel", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Confirm" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark 1 paid" }),
    );
  });

  it("returns focus to the trigger when Escape collapses the confirm", () => {
    renderTable([invoice("i-1", "INV-001", "sent")]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark 1 paid" }),
    );
  });

  it("parks focus on the strip master after a confirmed bulk mark-paid", async () => {
    bulkAction.mockResolvedValue(undefined);
    renderTable([invoice("i-1", "INV-001", "sent")]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select invoice INV-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(bulkAction).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const stripMaster = screen.getAllByRole("checkbox", {
        name: "Select all invoices",
      })[0];
      expect(document.activeElement).toBe(stripMaster);
    });
  });
});
