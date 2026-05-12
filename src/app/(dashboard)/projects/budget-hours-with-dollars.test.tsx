import { describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { BudgetHoursWithDollars } from "./budget-hours-with-dollars";

describe("BudgetHoursWithDollars", () => {
  it("renders both inputs when a rate is set and project isn't internal", () => {
    const { container } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate="135"
        isInternal={false}
      />,
    );
    const hours = container.querySelector(
      "input[name='budget_hours']",
    ) as HTMLInputElement;
    const dollars = container.querySelector(
      "#t1-budget-dollars",
    ) as HTMLInputElement;
    expect(hours).toBeTruthy();
    expect(dollars).toBeTruthy();
  });

  it("submits the hours value (not dollars) via the hidden name attribute", () => {
    const { container } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        defaultHours="60"
        hourlyRate="135"
        isInternal={false}
      />,
    );
    const hoursInput = container.querySelector(
      "input[name='budget_hours']",
    ) as HTMLInputElement;
    expect(hoursInput).toBeTruthy();
    expect(hoursInput.value).toBe("60");
    // No input with name=budget_dollars — the $ side is display-only.
    const dollarsByName = container.querySelector(
      "input[name='budget_dollars']",
    );
    expect(dollarsByName).toBeNull();
  });

  it("pre-fills the dollar field from defaultHours × rate on mount", () => {
    const { container } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        defaultHours="60"
        hourlyRate="135"
        isInternal={false}
      />,
    );
    const dollars = container.querySelector(
      "#t1-budget-dollars",
    ) as HTMLInputElement;
    // 60 * 135 = 8100.00
    expect(dollars.value).toBe("8100.00");
  });

  it("typing in the hours field updates the dollar field live", () => {
    const { container } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate="100"
        isInternal={false}
      />,
    );
    const hours = container.querySelector(
      "input[name='budget_hours']",
    ) as HTMLInputElement;
    const dollars = container.querySelector(
      "#t1-budget-dollars",
    ) as HTMLInputElement;
    fireEvent.change(hours, { target: { value: "40" } });
    expect(dollars.value).toBe("4000.00");
  });

  it("typing in the dollar field updates the hours field live", () => {
    const { container } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate="135"
        isInternal={false}
      />,
    );
    const hours = container.querySelector(
      "input[name='budget_hours']",
    ) as HTMLInputElement;
    const dollars = container.querySelector(
      "#t1-budget-dollars",
    ) as HTMLInputElement;
    fireEvent.change(dollars, { target: { value: "20000" } });
    // 20000 / 135 ≈ 148.15 → snapped to nearest 0.5 = 148.
    expect(Number(hours.value)).toBeGreaterThan(140);
    expect(Number(hours.value)).toBeLessThan(160);
  });

  it("hides the dollar side when the project is internal", () => {
    const { container } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        defaultHours="40"
        hourlyRate="135"
        isInternal
      />,
    );
    expect(container.querySelector("#t1-budget-dollars")).toBeNull();
    expect(
      container.querySelector("input[name='budget_hours']"),
    ).toBeTruthy();
  });

  it("hides the dollar side when hourlyRate is empty or zero", () => {
    const { container, rerender } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate=""
        isInternal={false}
      />,
    );
    expect(container.querySelector("#t1-budget-dollars")).toBeNull();
    rerender(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate="0"
        isInternal={false}
      />,
    );
    expect(container.querySelector("#t1-budget-dollars")).toBeNull();
  });

  it("recomputes the dollar field when the rate changes (hours-as-truth)", () => {
    const { container, rerender } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        defaultHours="60"
        hourlyRate="100"
        isInternal={false}
      />,
    );
    const hours = container.querySelector(
      "input[name='budget_hours']",
    ) as HTMLInputElement;
    const dollars = container.querySelector(
      "#t1-budget-dollars",
    ) as HTMLInputElement;
    // Initial: 60 * 100 = 6000.
    expect(dollars.value).toBe("6000.00");
    // Type into hours so lastEditedRef='hours'.
    fireEvent.change(hours, { target: { value: "60" } });
    // Rate bumps to 150.
    rerender(
      <BudgetHoursWithDollars
        idPrefix="t1"
        defaultHours="60"
        hourlyRate="150"
        isInternal={false}
      />,
    );
    // Hours stays 60 (truth), dollars now 9000.
    expect(hours.value).toBe("60");
    expect(dollars.value).toBe("9000.00");
  });

  it("when user typed dollars and the rate changes, dollars stay locked and hours auto-rebind", () => {
    const { container, rerender } = renderWithIntl(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate="100"
        isInternal={false}
      />,
    );
    const hours = container.querySelector(
      "input[name='budget_hours']",
    ) as HTMLInputElement;
    const dollars = container.querySelector(
      "#t1-budget-dollars",
    ) as HTMLInputElement;
    // User types $5000 — dollars becomes the "intent" (lastEditedRef).
    fireEvent.change(dollars, { target: { value: "5000" } });
    expect(Number(hours.value)).toBe(50);
    // Rate bumps to 200. Dollar intent stays $5000, hours rebind to 25.
    rerender(
      <BudgetHoursWithDollars
        idPrefix="t1"
        hourlyRate="200"
        isInternal={false}
      />,
    );
    expect(dollars.value).toBe("5000");
    expect(Number(hours.value)).toBe(25);
  });
});
