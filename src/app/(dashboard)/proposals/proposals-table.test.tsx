import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ProposalsTable, type ProposalRow } from "./proposals-table";

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
    ...overrides,
  };
}

describe("ProposalsTable", () => {
  it("shows the empty state when there are no proposals", () => {
    renderWithIntl(<ProposalsTable proposals={[]} />);
    expect(screen.getByText("No proposals yet")).toBeInTheDocument();
  });

  it("renders number, title, customer, status, and formatted total", () => {
    renderWithIntl(<ProposalsTable proposals={[row()]} />);
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
    renderWithIntl(<ProposalsTable proposals={[row({ customer: null })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
