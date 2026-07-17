import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ProposalSummaryTable } from "./ProposalSummaryTable";

const items = [
  { id: "a", title: "Basic upgrades", summary: "Routine hygiene", fixedPrice: 950 },
  { id: "b", title: "Compat layer", summary: "Closes a data gap", fixedPrice: 2500 },
];

describe("ProposalSummaryTable", () => {
  it("renders a numbered pricing table + total for 2+ items", () => {
    renderWithIntl(
      <ProposalSummaryTable items={items} total={3450} currency="USD" />,
    );
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Basic upgrades")).toBeInTheDocument();
    expect(screen.getByText("Compat layer")).toBeInTheDocument();
    expect(screen.getByText("$950.00")).toBeInTheDocument();
    expect(screen.getByText("$2,500.00")).toBeInTheDocument();
    expect(screen.getByText("$3,450.00")).toBeInTheDocument(); // total
  });

  it("shows the 'what it does' column when any item has a summary", () => {
    renderWithIntl(
      <ProposalSummaryTable items={items} total={3450} currency="USD" />,
    );
    expect(screen.getByText("What it does for you")).toBeInTheDocument();
    expect(screen.getByText("Routine hygiene")).toBeInTheDocument();
  });

  it("hides the 'what it does' column when no item has a summary", () => {
    const bare = items.map((i) => ({ ...i, summary: null }));
    renderWithIntl(
      <ProposalSummaryTable items={bare} total={3450} currency="USD" />,
    );
    expect(screen.queryByText("What it does for you")).not.toBeInTheDocument();
  });

  it("renders nothing for a single item (it's its own summary)", () => {
    const { container } = renderWithIntl(
      <ProposalSummaryTable items={[items[0]!]} total={950} currency="USD" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
