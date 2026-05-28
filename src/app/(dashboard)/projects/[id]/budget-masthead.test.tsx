import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { BudgetMasthead } from "./budget-masthead";

// Minimal masthead — a lifetime cap so the card renders. The
// footer is the focus; the budget bar itself is exercised by
// existing visual usage in /projects/[id].
const baseProps = {
  projectId: "p-1",
  lifetimeMinutes: 0,
  lifetimeBudgetHours: 40,
  lifetimeRate: 100,
  lifetimeBudgetDollars: null,
  period: null,
};

describe("BudgetMasthead — expense totals footer", () => {
  it("hides the footer when expenseTotalsByCurrency is null", () => {
    renderWithIntl(
      <BudgetMasthead {...baseProps} expenseTotalsByCurrency={null} />,
    );
    expect(screen.queryByText(/in expenses/i)).toBeNull();
  });

  it("hides the footer when expenseTotalsByCurrency is an empty map", () => {
    renderWithIntl(
      <BudgetMasthead {...baseProps} expenseTotalsByCurrency={{}} />,
    );
    expect(screen.queryByText(/in expenses/i)).toBeNull();
  });

  it("renders a single per-currency line when one currency is present", () => {
    renderWithIntl(
      <BudgetMasthead
        {...baseProps}
        expenseTotalsByCurrency={{ USD: 1234.5 }}
      />,
    );
    // Intl formats 1234.5 as "$1,234.50" in en-US.
    expect(screen.getByText(/\$1,234\.50 in expenses/i)).toBeInTheDocument();
  });

  it("stacks one line per currency, sorted alphabetically by currency code", () => {
    renderWithIntl(
      <BudgetMasthead
        {...baseProps}
        expenseTotalsByCurrency={{ USD: 100, EUR: 50 }}
      />,
    );
    // EUR sorts before USD; both lines render.
    const eur = screen.getByText(/€50\.00 in expenses/i);
    const usd = screen.getByText(/\$100\.00 in expenses/i);
    expect(eur).toBeInTheDocument();
    expect(usd).toBeInTheDocument();
    // Visual order: EUR above USD.
    const all = screen.getAllByText(/in expenses/i);
    expect(all.indexOf(eur)).toBeLessThan(all.indexOf(usd));
  });

  it("falls back to '<code> <amount>' when Intl rejects the currency code", () => {
    renderWithIntl(
      <BudgetMasthead
        {...baseProps}
        expenseTotalsByCurrency={{ NOTREAL: 42 }}
      />,
    );
    // A bogus currency triggers the catch branch — verifies the
    // footer doesn't crash on malformed CSV-imported data.
    expect(
      screen.getByText(/NOTREAL 42\.00 in expenses/i),
    ).toBeInTheDocument();
  });

  it("still hides the entire card when no budget signal AND no expenses", () => {
    renderWithIntl(
      <BudgetMasthead
        projectId="p-1"
        lifetimeMinutes={0}
        lifetimeBudgetHours={null}
        lifetimeRate={null}
        lifetimeBudgetDollars={null}
        period={null}
        expenseTotalsByCurrency={{ USD: 100 }}
      />,
    );
    // Expenses alone don't justify the masthead — by design, the
    // expense section below is the canonical home for raw totals.
    // Card hides entirely when no budget is set, even with expenses.
    expect(screen.queryByText(/in expenses/i)).toBeNull();
  });
});
