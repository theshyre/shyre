import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/test/intl";
import { screen, fireEvent } from "@testing-library/react";

const setTextSizeMock = vi.fn();
let mockedTextSize: "compact" | "regular" | "large" = "regular";

vi.mock("./text-size-provider", () => ({
  useTextSize: () => ({
    textSize: mockedTextSize,
    setTextSize: (v: "compact" | "regular" | "large") => {
      mockedTextSize = v;
      setTextSizeMock(v);
    },
  }),
}));

import { TextSizeSwitcher } from "./TextSizeSwitcher";

beforeEach(() => {
  mockedTextSize = "regular";
  setTextSizeMock.mockReset();
});

describe("TextSizeSwitcher", () => {
  it("renders three radios in a labeled radiogroup", () => {
    const { container } = renderWithIntl(<TextSizeSwitcher />);
    const group = container.querySelector("div[role='radiogroup']");
    expect(group).not.toBeNull();
    const radios = container.querySelectorAll("button[role='radio']");
    expect(radios).toHaveLength(3);
  });

  it("marks the active size as aria-checked", () => {
    const { container } = renderWithIntl(<TextSizeSwitcher />);
    const radios = container.querySelectorAll("button[role='radio']");
    // Default mocked size is "regular" — middle.
    expect(radios[0]?.getAttribute("aria-checked")).toBe("false");
    expect(radios[1]?.getAttribute("aria-checked")).toBe("true");
    expect(radios[2]?.getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a size button calls setTextSize with that size", () => {
    const { container } = renderWithIntl(<TextSizeSwitcher />);
    const radios = container.querySelectorAll("button[role='radio']");
    fireEvent.click(radios[0]!);
    expect(setTextSizeMock).toHaveBeenCalledWith("compact");
  });

  it("dense=true renders smaller buttons (h-7) than default (h-8)", () => {
    const { container, rerender } = renderWithIntl(<TextSizeSwitcher />);
    const def = container.querySelector("button[role='radio']");
    expect(def?.className).toContain("h-8");
    rerender(<TextSizeSwitcher dense />);
    const dense = container.querySelector("button[role='radio']");
    expect(dense?.className).toContain("h-7");
  });

  it("each button uses the letter 'A' as the visual content", () => {
    renderWithIntl(<TextSizeSwitcher />);
    const buttons = screen.getAllByRole("radio");
    for (const b of buttons) {
      expect(b.textContent).toBe("A");
    }
  });

  it("preview font-size scales per button (11/13/15 px)", () => {
    const { container } = renderWithIntl(<TextSizeSwitcher />);
    const buttons = container.querySelectorAll("button[role='radio']");
    expect((buttons[0] as HTMLElement).style.fontSize).toBe("11px");
    expect((buttons[1] as HTMLElement).style.fontSize).toBe("13px");
    expect((buttons[2] as HTMLElement).style.fontSize).toBe("15px");
  });
});
