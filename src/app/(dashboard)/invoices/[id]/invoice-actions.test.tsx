import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const recordPaymentMock = vi.fn();
const updateStatusMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("../actions", () => ({
  recordInvoicePaymentAction: (fd: FormData) => recordPaymentMock(fd),
  updateInvoiceStatusAction: (fd: FormData) => updateStatusMock(fd),
  deleteInvoiceAction: (fd: FormData) => deleteMock(fd),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

import { InvoiceActions } from "./invoice-actions";

const baseProps = {
  invoiceId: "inv-1",
  currentStatus: "sent",
  invoiceNumber: "INV-2026-149",
  invoiceTotal: 33.75,
  paymentsTotal: 0,
  currency: "USD",
};

beforeEach(() => {
  recordPaymentMock.mockReset();
  updateStatusMock.mockReset();
  deleteMock.mockReset();
  refreshMock.mockReset();
});

describe("InvoiceActions — layout", () => {
  it("keeps the action row from stretching sibling buttons (items-start)", () => {
    const { container } = renderWithIntl(<InvoiceActions {...baseProps} />);
    // The regression: default align-items:stretch turned Void/Overdue into
    // tall empty boxes when the payment panel opened. The row must pin to
    // the top so an open panel can't distort its siblings.
    const row = container.querySelector("div.flex.flex-wrap");
    expect(row?.className).toContain("items-start");
  });
});

describe("InvoiceActions — Record payment", () => {
  it("opens the payment form as a floating dropdown, not an inline block", () => {
    renderWithIntl(<InvoiceActions {...baseProps} />);
    const trigger = screen.getByRole("button", { name: /Record payment/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: /Record a payment/,
    });
    // Floating: absolutely positioned so it overlays rather than pushing
    // the button row around.
    expect(dialog.className).toContain("absolute");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("defaults the amount to the balance due", () => {
    renderWithIntl(<InvoiceActions {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));
    const amount = screen.getByLabelText("Amount") as HTMLInputElement;
    expect(amount.value).toBe("33.75");
  });

  it("records the payment with the entered amount + paid date", async () => {
    recordPaymentMock.mockResolvedValue({ success: true });
    renderWithIntl(<InvoiceActions {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1));
    const fd = recordPaymentMock.mock.calls[0]![0] as FormData;
    expect(fd.get("invoice_id")).toBe("inv-1");
    expect(fd.get("amount")).toBe("33.75");
    expect(fd.get("paid_on")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a server refusal inline instead of silently failing", async () => {
    recordPaymentMock.mockResolvedValue({
      success: false,
      error: { message: "Paid date is before the invoice's issued date." },
    });
    renderWithIntl(<InvoiceActions {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/before the invoice/),
    );
  });

  it("closes on Cancel without recording", () => {
    renderWithIntl(<InvoiceActions {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(recordPaymentMock).not.toHaveBeenCalled();
  });
});
