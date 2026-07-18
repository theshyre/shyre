import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// PaginationFooter (rendered by the table) reads the URL.
vi.mock("next/navigation", () => ({
  usePathname: () => "/proposals",
  useSearchParams: () => new URLSearchParams(),
}));

import { ProposalsTable, type ProposalRow } from "./proposals-table";

const TODAY = "2026-07-17";

function row(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: "p1",
    proposal_number: "PROP-2026-001",
    title: "Modernization work",
    status: "draft",
    issued_date: "2026-07-16",
    valid_until: null,
    currency: "USD",
    customer: { id: "c1", name: "EyeReg Consulting", logo_url: null },
    total: 4950,
    accepted_total: null,
    ...overrides,
  };
}

function renderTable(
  proposals: ProposalRow[],
  totalCount = proposals.length,
): void {
  renderWithIntl(
    <ProposalsTable
      proposals={proposals}
      totalCount={totalCount}
      today={TODAY}
    />,
  );
}

describe("ProposalsTable", () => {
  it("shows the empty state when there are no proposals", () => {
    renderTable([]);
    expect(screen.getByText("No proposals yet")).toBeInTheDocument();
  });

  it("renders number, title, customer, status, and formatted total", () => {
    renderTable([row()]);
    expect(
      screen.getByRole("link", { name: "PROP-2026-001" }),
    ).toHaveAttribute("href", "/proposals/p1");
    expect(screen.getByText("Modernization work")).toBeInTheDocument();
    expect(screen.getByText("EyeReg Consulting")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("$4,950.00")).toBeInTheDocument();
    expect(screen.getByText("2026-07-16")).toBeInTheDocument();
  });

  it("renders a dash for a missing customer", () => {
    renderTable([row({ customer: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an aging caption on in-flight rows sent 1+ days ago", () => {
    renderTable([
      row({ id: "p1", status: "sent", issued_date: "2026-07-10" }),
      row({
        id: "p2",
        proposal_number: "PROP-2026-002",
        status: "viewed",
        issued_date: "2026-07-17",
      }),
      row({
        id: "p3",
        proposal_number: "PROP-2026-003",
        status: "draft",
        issued_date: "2026-07-01",
      }),
    ]);
    // 7 days for the sent row; nothing for same-day or draft rows.
    expect(screen.getByText("sent 7d ago")).toBeInTheDocument();
    expect(screen.getAllByText(/sent \d+d ago/)).toHaveLength(1);
  });

  it("relabels a lapsed sent proposal as Expired (read-time cue)", () => {
    renderTable([
      row({ status: "sent", valid_until: "2026-07-01" }),
    ]);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("keeps the Sent badge while valid_until is still in the future", () => {
    renderTable([
      row({ status: "sent", valid_until: "2026-08-01" }),
    ]);
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("shows the accepted subset total instead of the full total once accepted", () => {
    renderTable([
      row({ status: "accepted", total: 4950, accepted_total: 3000 }),
    ]);
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
    expect(screen.queryByText("$4,950.00")).not.toBeInTheDocument();
  });

  it("renders a load-more footer when more rows match than are loaded", () => {
    renderTable([row()], 120);
    expect(screen.getByText("Showing 1 of 120")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Load 50 more/ }),
    ).toBeInTheDocument();
  });

  it("omits the footer when everything is loaded", () => {
    renderTable([row()], 1);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});
