import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PaymentTermsField } from "./PaymentTermsField";

const messages = {
  paymentTerms: {
    ariaGroup: "Payment terms",
    label: "Payment terms",
    dueOnReceipt: "Due on receipt",
    netN: "Net {n}",
    custom: "Custom",
    customPlaceholder: "Days",
    customAriaLabel: "Custom payment terms in days",
    customSuffix: "days",
  },
};

/**
 * Stateful wrapper around PaymentTermsField that mirrors how every
 * call site uses it: parent owns the value, passes it as `value`,
 * and receives changes via `onChange`. The component is fully
 * controlled — bypassing parent state would silently no-op clicks.
 */
function ControlledHarness({
  initial,
  inheritLabel,
}: {
  initial: number | null;
  inheritLabel: string | null;
}): React.JSX.Element {
  const [days, setDays] = useState<number | null>(initial);
  return (
    <PaymentTermsField
      name="terms"
      value={days}
      onChange={setDays}
      inheritLabel={inheritLabel}
    />
  );
}

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function hiddenInputValue(container: HTMLElement, name: string): string {
  const el = container.querySelector(
    `input[type="hidden"][name="${name}"]`,
  ) as HTMLInputElement | null;
  return el?.value ?? "";
}

describe("PaymentTermsField", () => {
  it("renders all preset chips + Custom + inherit", () => {
    renderWithIntl(
      <ControlledHarness initial={null} inheritLabel="Use team default" />,
    );
    expect(screen.getByText("Use team default")).toBeDefined();
    expect(screen.getByText("Due on receipt")).toBeDefined();
    expect(screen.getByText("Net 15")).toBeDefined();
    expect(screen.getByText("Net 30")).toBeDefined();
    expect(screen.getByText("Net 45")).toBeDefined();
    expect(screen.getByText("Net 60")).toBeDefined();
    expect(screen.getByText("Net 90")).toBeDefined();
    expect(screen.getByText("Custom")).toBeDefined();
  });

  it("hidden input is empty when value is null and inherit is selected", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={null} inheritLabel="Use team default" />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("");
  });

  it("clicking a preset chip updates the hidden input via parent state", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={null} inheritLabel="Use team default" />,
    );
    fireEvent.click(screen.getByText("Net 30"));
    expect(hiddenInputValue(container, "terms")).toBe("30");
  });

  it("initial 30 selects the Net 30 chip and seeds the hidden input", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={30} inheritLabel="Use team default" />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("30");
    const net30 = screen.getByText("Net 30").closest("button");
    expect(net30?.getAttribute("aria-checked")).toBe("true");
  });

  it("initial 7 (non-preset) lands in Custom with the number input filled", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={7} inheritLabel="Use team default" />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("7");
    const custom = screen.getByText("Custom").closest("button");
    expect(custom?.getAttribute("aria-checked")).toBe("true");
    const numberInput = container.querySelector(
      "input[type='number']",
    ) as HTMLInputElement | null;
    expect(numberInput?.value).toBe("7");
  });

  it("clicking inherit clears the value", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={30} inheritLabel="Use team default" />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("30");
    fireEvent.click(screen.getByText("Use team default"));
    expect(hiddenInputValue(container, "terms")).toBe("");
  });

  it("hides the inherit chip when inheritLabel is null (required mode)", () => {
    renderWithIntl(<ControlledHarness initial={30} inheritLabel={null} />);
    expect(screen.queryByText("Use team default")).toBeNull();
  });

  it("typing in Custom updates the hidden input", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={null} inheritLabel="Use team default" />,
    );
    fireEvent.click(screen.getByText("Custom"));
    const numberInput = container.querySelector(
      "input[type='number']",
    ) as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "21" } });
    expect(hiddenInputValue(container, "terms")).toBe("21");
  });

  it("0 (Due on receipt) is selectable", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={null} inheritLabel="Use team default" />,
    );
    fireEvent.click(screen.getByText("Due on receipt"));
    expect(hiddenInputValue(container, "terms")).toBe("0");
    const chip = screen.getByText("Due on receipt").closest("button");
    expect(chip?.getAttribute("aria-checked")).toBe("true");
  });

  it("clicking the Custom chip with no draft emits null (no NaN)", () => {
    const { container } = renderWithIntl(
      <ControlledHarness initial={null} inheritLabel="Use team default" />,
    );
    fireEvent.click(screen.getByText("Custom"));
    // No number typed yet — hidden stays empty so the action gets null.
    expect(hiddenInputValue(container, "terms")).toBe("");
  });

  it("does NOT fire onChange on parent re-render (regression: select-doesn't-take bug)", () => {
    // Earlier revision had a useEffect that called `onChange` whenever
    // the parent's inline arrow function changed identity (every
    // render), which raced with the parent's own state update and
    // caused the customer select's first click to appear to "not
    // take." Fully-controlled refactor removed the effect entirely;
    // assert that re-rendering doesn't spam onChange.
    let renderCount = 0;
    let onChangeCalls = 0;

    function Probe(): React.JSX.Element {
      renderCount++;
      const [, setTick] = useState(0);
      const trigger = (): void => setTick((n) => n + 1);
      return (
        <div>
          <button type="button" onClick={trigger}>
            re-render
          </button>
          <PaymentTermsField
            name="terms"
            value={null}
            inheritLabel="Inherit"
            onChange={() => {
              onChangeCalls++;
            }}
          />
        </div>
      );
    }

    renderWithIntl(<Probe />);
    expect(renderCount).toBe(1);
    expect(onChangeCalls).toBe(0);
    // Force a parent re-render. onChange must NOT fire — only chip
    // clicks should.
    fireEvent.click(screen.getByText("re-render"));
    expect(renderCount).toBeGreaterThanOrEqual(2);
    expect(onChangeCalls).toBe(0);
  });
});
