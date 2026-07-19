import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/invoices",
  useSearchParams: () => mockSearchParams,
}));

// The DateField calendar/commit mechanics are tested with the promoted
// component in theshyre-core; here we only care that a committed date
// patches the URL, so stand in a plain input that forwards onChange.
vi.mock("@/components/DateField", () => ({
  DateField: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (next: string) => void;
  }) => (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import {
  InvoiceStatusFilter,
  InvoiceCustomerFilter,
  InvoiceIssuedDateFilter,
  InvoiceFiltersClearAll,
  InvoiceFiltersNoResultsHint,
  hasActiveInvoiceFilters,
} from "./invoice-filters";

const customers = [
  { id: "c1", name: "Acme" },
  { id: "c2", name: "Beta Corp" },
];

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe("InvoiceStatusFilter", () => {
  it("exposes '{dimension}: {value}' as the trigger's accessible name", () => {
    renderWithIntl(<InvoiceStatusFilter selected={null} />);
    const trigger = screen.getByRole("button", { name: "Status: Any status" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lists Any + all five statuses with the current one selected", () => {
    renderWithIntl(<InvoiceStatusFilter selected="paid" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Paid" }));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Any status",
      "Draft",
      "Sent",
      "Paid",
      "Void",
      "Overdue",
    ]);
    expect(screen.getByRole("option", { name: "Paid" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("instant-applies ?status= and resets ?limit=", () => {
    mockSearchParams = new URLSearchParams("org=t-1&limit=150");
    renderWithIntl(<InvoiceStatusFilter selected={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Any status" }));
    fireEvent.click(screen.getByRole("option", { name: "Overdue" }));
    expect(mockPush).toHaveBeenCalledWith("/invoices?org=t-1&status=overdue");
  });

  it("strips ?status= when picking the default (Any status)", () => {
    mockSearchParams = new URLSearchParams("status=paid&customerId=c1");
    renderWithIntl(<InvoiceStatusFilter selected="paid" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Paid" }));
    fireEvent.click(screen.getByRole("option", { name: "Any status" }));
    expect(mockPush).toHaveBeenCalledWith("/invoices?customerId=c1");
  });
});

describe("InvoiceCustomerFilter", () => {
  it("renders nothing when there are no customers", () => {
    const { container } = renderWithIntl(
      <InvoiceCustomerFilter selectedCustomerId={null} customers={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("exposes 'Customer: {name}' as the trigger's accessible name", () => {
    renderWithIntl(
      <InvoiceCustomerFilter selectedCustomerId="c2" customers={customers} />,
    );
    expect(
      screen.getByRole("button", { name: "Customer: Beta Corp" }),
    ).toBeInTheDocument();
  });

  it("falls back to the unknown label for a stale customer id", () => {
    renderWithIntl(
      <InvoiceCustomerFilter selectedCustomerId="gone" customers={customers} />,
    );
    expect(
      screen.getByRole("button", { name: "Customer: Unknown customer" }),
    ).toBeInTheDocument();
  });

  it("instant-applies ?customerId= and resets ?limit=", () => {
    mockSearchParams = new URLSearchParams("limit=100");
    renderWithIntl(
      <InvoiceCustomerFilter selectedCustomerId={null} customers={customers} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Customer: Any customer" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Acme" }));
    expect(mockPush).toHaveBeenCalledWith("/invoices?customerId=c1");
  });

  it("strips ?customerId= when picking Any customer", () => {
    mockSearchParams = new URLSearchParams("customerId=c1&status=sent");
    renderWithIntl(
      <InvoiceCustomerFilter selectedCustomerId="c1" customers={customers} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Customer: Acme" }));
    fireEvent.click(screen.getByRole("option", { name: "Any customer" }));
    expect(mockPush).toHaveBeenCalledWith("/invoices?status=sent");
  });
});

describe("InvoiceIssuedDateFilter", () => {
  it("renders a visibly labeled from/to pair", () => {
    renderWithIntl(<InvoiceIssuedDateFilter from={null} to={null} />);
    expect(screen.getByLabelText("Issued from")).toBeInTheDocument();
    expect(screen.getByLabelText("Issued to")).toBeInTheDocument();
  });

  it("instant-applies ?from= and resets ?limit=", () => {
    mockSearchParams = new URLSearchParams("limit=100");
    renderWithIntl(<InvoiceIssuedDateFilter from={null} to={null} />);
    fireEvent.change(screen.getByLabelText("Issued from"), {
      target: { value: "2026-07-01" },
    });
    expect(mockPush).toHaveBeenCalledWith("/invoices?from=2026-07-01");
  });

  it("strips ?to= when the date is cleared", () => {
    mockSearchParams = new URLSearchParams("from=2026-07-01&to=2026-07-31");
    renderWithIntl(
      <InvoiceIssuedDateFilter from="2026-07-01" to="2026-07-31" />,
    );
    fireEvent.change(screen.getByLabelText("Issued to"), {
      target: { value: "" },
    });
    expect(mockPush).toHaveBeenCalledWith("/invoices?from=2026-07-01");
  });
});

describe("InvoiceFiltersClearAll", () => {
  const inactive = { status: null, customerId: null, from: null, to: null };

  it("renders nothing when every filter is at its default", () => {
    const { container } = renderWithIntl(
      <InvoiceFiltersClearAll filters={inactive} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("clears status, customer, dates, and limit in one push — keeping ?org=", () => {
    mockSearchParams = new URLSearchParams(
      "org=t-1&status=paid&customerId=c1&from=2026-01-01&to=2026-06-30&limit=200",
    );
    renderWithIntl(
      <InvoiceFiltersClearAll
        filters={{
          status: "paid",
          customerId: "c1",
          from: "2026-01-01",
          to: "2026-06-30",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(mockPush).toHaveBeenCalledWith("/invoices?org=t-1");
  });
});

describe("hasActiveInvoiceFilters", () => {
  it("is false at defaults and true when any dimension is set", () => {
    expect(
      hasActiveInvoiceFilters({
        status: null,
        customerId: null,
        from: null,
        to: null,
      }),
    ).toBe(false);
    expect(
      hasActiveInvoiceFilters({
        status: null,
        customerId: null,
        from: "2026-01-01",
        to: null,
      }),
    ).toBe(true);
  });
});

describe("InvoiceFiltersNoResultsHint", () => {
  it("renders nothing when inactive", () => {
    const { container } = renderWithIntl(
      <InvoiceFiltersNoResultsHint active={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("names the situation and clears the filters on click", () => {
    mockSearchParams = new URLSearchParams(
      "org=t-1&status=void&from=2026-01-01&limit=100",
    );
    renderWithIntl(<InvoiceFiltersNoResultsHint active />);
    expect(
      screen.getByText("No invoices match the current filters."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(mockPush).toHaveBeenCalledWith("/invoices?org=t-1");
  });
});
