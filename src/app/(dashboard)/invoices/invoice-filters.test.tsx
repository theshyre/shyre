import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { InvoiceFilters } from "./invoice-filters";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

const customers = [
  { id: "c1", name: "Acme" },
  { id: "c2", name: "Beta Corp" },
];

const emptyFilters = {
  status: null,
  customerId: null,
  from: null,
  to: null,
};

describe("InvoiceFilters", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("renders status, customer, from, to controls", () => {
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId={null}
        customers={customers}
        currentFilters={emptyFilters}
      />,
    );
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/from/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
  });

  it("populates the status select with every invoice status", () => {
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId={null}
        customers={customers}
        currentFilters={emptyFilters}
      />,
    );
    const status = screen.getByLabelText(/status/i) as HTMLSelectElement;
    const options = Array.from(status.options).map((o) => o.value);
    // 1 placeholder + 5 statuses
    expect(options).toContain("draft");
    expect(options).toContain("sent");
    expect(options).toContain("paid");
    expect(options).toContain("overdue");
    expect(options).toContain("void");
  });

  it("populates the customer select from the candidate list", () => {
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId={null}
        customers={customers}
        currentFilters={emptyFilters}
      />,
    );
    expect(screen.getByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Beta Corp" }),
    ).toBeInTheDocument();
  });

  it("apply pushes the URL with the current selections", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId={null}
        customers={customers}
        currentFilters={emptyFilters}
      />,
    );
    const status = screen.getByLabelText(/status/i);
    await user.selectOptions(status, "paid");
    const customer = screen.getByLabelText(/client/i);
    await user.selectOptions(customer, "c1");

    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const pushed = mockPush.mock.calls[0]?.[0] as string;
    expect(pushed).toContain("status=paid");
    expect(pushed).toContain("customerId=c1");
  });

  it("apply preserves the existing org param when set", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId="team-a"
        customers={customers}
        currentFilters={emptyFilters}
      />,
    );
    await user.selectOptions(screen.getByLabelText(/status/i), "sent");
    await user.click(screen.getByRole("button", { name: /apply/i }));
    const pushed = mockPush.mock.calls[0]?.[0] as string;
    expect(pushed).toContain("org=team-a");
  });

  it("clear resets all filters and removes them from the URL", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId={null}
        customers={customers}
        currentFilters={{
          status: "paid",
          customerId: "c1",
          from: "2026-04-01",
          to: "2026-04-30",
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(mockPush).toHaveBeenCalledWith("/invoices");
  });

  it("hides the Clear button when no filter is active", () => {
    renderWithIntl(
      <InvoiceFilters
        selectedTeamId={null}
        customers={customers}
        currentFilters={emptyFilters}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /clear/i }),
    ).not.toBeInTheDocument();
  });
});
