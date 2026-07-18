/**
 * Wrapper-level tests only: the calendar/keyboard/parsing behavior is
 * tested in theshyre-core alongside the promoted component. Here we
 * verify the one thing the wrapper owns — injecting next-intl
 * translations and the active locale into the package component.
 */
import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/intl";
import { DateField, localeToFormat } from "./DateField";

describe("DateField wrapper", () => {
  it("injects translated labels from common.dateField", () => {
    render(<DateField value="" onChange={() => {}} ariaLabel="Date" />);
    const trigger = screen.getByRole("button", { name: "Open calendar" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });

  it("labels today's cell with the translated suffix", () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    render(<DateField value="" onChange={() => {}} ariaLabel="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByLabelText(`${iso}, today`)).toBeTruthy();
  });

  it("re-exports the helpers unchanged", () => {
    expect(localeToFormat("en-US")).toBe("us");
    expect(localeToFormat("es")).toBe("dmy");
  });
});
