import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { InvoicePreviewModal } from "./invoice-preview-modal";

// Subset of strings the modal renders. Real EN messages aren't
// imported because the test would otherwise pull in the entire
// next-intl namespace machinery; this is the documented minimal
// shape the component reads.
const messages = {
  invoices: {
    title: "Invoices",
    pdf: { date: "Date", dueDate: "Due Date" },
    servicePeriod: "Service period",
    fields: {
      subtotal: "Subtotal",
      discount: "Discount",
      taxAmount: "Tax",
      total: "Total",
      notes: "Notes",
    },
    new: {
      preview: {
        fullModalTitle: "Invoice preview",
        fullModalSubtitle: "Draft view",
        fullBillTo: "Bill to",
        fullBusinessFallback: "Your business",
        fullCustomerFallback: "(No customer selected)",
        fullNoLines: "No line items in the current selection.",
        fullColDescription: "Description",
        fullColQty: "Qty",
        fullColRate: "Rate",
        fullColAmount: "Amount",
      },
    },
  },
  common: {
    actions: { close: "Close" },
  },
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const baseProps = {
  open: true,
  onClose: () => {},
  invoiceNumber: "INV-0042",
  customerName: "Pierce Clark",
  issuedDate: "2026-05-02",
  dueDate: "2026-06-01",
  paymentTermsDays: 30,
  periodStart: "2026-04-01",
  periodEnd: "2026-04-30",
  lines: [
    {
      description: "Engineering — April",
      quantity: 12,
      unitPrice: 150,
      amount: 1800,
    },
    {
      description: "Design — April",
      quantity: 4,
      unitPrice: 150,
      amount: 600,
    },
  ],
  subtotal: 2400,
  discountAmount: 0,
  discountRate: null,
  taxRate: 0,
  taxAmount: 0,
  total: 2400,
  notes: null,
  businessName: "Malcom IO",
};

describe("InvoicePreviewModal", () => {
  it("renders nothing when closed", () => {
    const { container } = renderWithIntl(
      <InvoicePreviewModal {...baseProps} open={false} />,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the invoice number, business, and customer", () => {
    renderWithIntl(<InvoicePreviewModal {...baseProps} />);
    expect(screen.getByText("INV-0042")).toBeDefined();
    expect(screen.getByText("Malcom IO")).toBeDefined();
    expect(screen.getByText("Pierce Clark")).toBeDefined();
  });

  it("renders dates and the Net N suffix on due date", () => {
    renderWithIntl(<InvoicePreviewModal {...baseProps} />);
    expect(screen.getByText("2026-05-02")).toBeDefined();
    expect(screen.getByText("2026-06-01 (Net 30)")).toBeDefined();
  });

  it("renders all line items, not just first 5", () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({
      description: `Line ${i + 1}`,
      quantity: 1,
      unitPrice: 100,
      amount: 100,
    }));
    renderWithIntl(
      <InvoicePreviewModal
        {...baseProps}
        lines={lines}
        subtotal={800}
        total={800}
      />,
    );
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`Line ${i}`)).toBeDefined();
    }
  });

  it("renders empty-state copy when no lines", () => {
    renderWithIntl(
      <InvoicePreviewModal
        {...baseProps}
        lines={[]}
        subtotal={0}
        total={0}
      />,
    );
    expect(
      screen.getByText("No line items in the current selection."),
    ).toBeDefined();
  });

  it("hides the discount row when discountAmount is 0", () => {
    renderWithIntl(<InvoicePreviewModal {...baseProps} />);
    expect(screen.queryByText("Discount")).toBeNull();
  });

  it("renders discount + tax rows when present", () => {
    renderWithIntl(
      <InvoicePreviewModal
        {...baseProps}
        discountAmount={120}
        discountRate={5}
        taxRate={8.875}
        taxAmount={202.31}
      />,
    );
    expect(screen.getByText("Discount (5%)")).toBeDefined();
    expect(screen.getByText("Tax (8.875%)")).toBeDefined();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderWithIntl(<InvoicePreviewModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders notes when provided", () => {
    renderWithIntl(
      <InvoicePreviewModal
        {...baseProps}
        notes="Payment due on receipt; thanks!"
      />,
    );
    expect(
      screen.getByText("Payment due on receipt; thanks!"),
    ).toBeDefined();
  });
});
