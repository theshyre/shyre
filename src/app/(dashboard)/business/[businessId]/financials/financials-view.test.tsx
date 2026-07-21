import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { FinancialsView, type FinancialsData } from "./financials-view";

// Reveal state persists in localStorage (per device); reset between tests
// so each starts from the blurred default.
beforeEach(() => {
  window.localStorage.clear();
});

function makeData(overrides: Partial<FinancialsData> = {}): FinancialsData {
  return {
    businessId: "biz-1",
    period: "last12",
    periodLabel: "Last 12 months",
    collected: [["USD", 14500]],
    revenue: [["USD", 13000]],
    tax: [["USD", 1500]],
    expenses: [["USD", 2050]],
    net: { currency: "USD", amount: 10950 },
    arTotal: [["USD", 8200]],
    arAging: [
      {
        currency: "USD",
        buckets: { current: 5000, d1_30: 3200, d31_60: 0, d61_90: 0, d90_plus: 0 },
      },
    ],
    unbilledHours: 22,
    lockedThrough: null,
    ...overrides,
  };
}

describe("FinancialsView", () => {
  it("masks all amounts by default (screen-share safe) and shows labels", () => {
    renderWithIntl(<FinancialsView data={makeData()} />);
    // Labels visible.
    expect(screen.getByText("Collected")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    // Numbers not rendered while hidden.
    expect(screen.queryByText("$14,500.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$13,000/)).not.toBeInTheDocument();
    // Reveal control offers to reveal.
    expect(
      screen.getByRole("button", { name: "Reveal amounts" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals the real figures on toggle", () => {
    renderWithIntl(<FinancialsView data={makeData()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal amounts" }));
    expect(screen.getByText("$14,500.00")).toBeInTheDocument();
    expect(screen.getByText("$2,050.00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide amounts" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the Net word so profit/loss isn't color-only", () => {
    renderWithIntl(<FinancialsView data={makeData()} />);
    expect(screen.getByText("Profit")).toBeInTheDocument();
    // A loss surfaces the Loss word + sign once revealed.
    renderWithIntl(
      <FinancialsView
        data={makeData({ net: { currency: "USD", amount: -500 } })}
      />,
    );
    expect(screen.getByText("Loss")).toBeInTheDocument();
  });

  it("shows a mixed-currency message instead of a wrong Net", () => {
    renderWithIntl(<FinancialsView data={makeData({ net: null })} />);
    expect(
      screen.getByText(/Mixed currencies/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Profit")).not.toBeInTheDocument();
  });

  it("surfaces a period-lock banner when a period is closed", () => {
    renderWithIntl(
      <FinancialsView data={makeData({ lockedThrough: "2026-03-31" })} />,
    );
    expect(screen.getByText(/locked through/)).toBeInTheDocument();
  });
});
