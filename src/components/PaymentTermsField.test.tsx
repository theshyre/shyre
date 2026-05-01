import { describe, it, expect } from "vitest";
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
  it("renders all preset chips + Custom", () => {
    renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={null}
        inheritLabel="Use team default"
      />,
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

  it("hidden input is empty when defaultValue is null and inherit is selected", () => {
    const { container } = renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={null}
        inheritLabel="Use team default"
      />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("");
  });

  it("clicking a preset chip sets the hidden input", () => {
    const { container } = renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={null}
        inheritLabel="Use team default"
      />,
    );
    fireEvent.click(screen.getByText("Net 30"));
    expect(hiddenInputValue(container, "terms")).toBe("30");
  });

  it("defaultValue 30 selects the Net 30 chip", () => {
    const { container } = renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={30}
        inheritLabel="Use team default"
      />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("30");
    const net30 = screen.getByText("Net 30").closest("button");
    expect(net30?.getAttribute("aria-checked")).toBe("true");
  });

  it("defaultValue 7 (non-preset) lands in Custom with the number input filled", () => {
    const { container } = renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={7}
        inheritLabel="Use team default"
      />,
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
      <PaymentTermsField
        name="terms"
        defaultValue={30}
        inheritLabel="Use team default"
      />,
    );
    expect(hiddenInputValue(container, "terms")).toBe("30");
    fireEvent.click(screen.getByText("Use team default"));
    expect(hiddenInputValue(container, "terms")).toBe("");
  });

  it("hides the inherit chip when inheritLabel is null (required mode)", () => {
    renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={30}
        inheritLabel={null}
      />,
    );
    expect(screen.queryByText("Use team default")).toBeNull();
  });

  it("typing in Custom updates the hidden input", () => {
    const { container } = renderWithIntl(
      <PaymentTermsField
        name="terms"
        defaultValue={null}
        inheritLabel="Use team default"
      />,
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
      <PaymentTermsField
        name="terms"
        defaultValue={null}
        inheritLabel="Use team default"
      />,
    );
    fireEvent.click(screen.getByText("Due on receipt"));
    expect(hiddenInputValue(container, "terms")).toBe("0");
    const chip = screen.getByText("Due on receipt").closest("button");
    expect(chip?.getAttribute("aria-checked")).toBe("true");
  });
});
