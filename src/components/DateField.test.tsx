import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DateField, parseIsoDate, looseParse } from "./DateField";

describe("parseIsoDate", () => {
  it("parses a valid ISO date", () => {
    const d = parseIsoDate("2026-04-30");
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(3);
    expect(d?.getDate()).toBe(30);
  });

  it("rejects an overflow ISO (Feb 31)", () => {
    expect(parseIsoDate("2026-02-31")).toBeNull();
  });

  it("rejects a malformed ISO", () => {
    expect(parseIsoDate("2026/04/30")).toBeNull();
    expect(parseIsoDate("4/30/2026")).toBeNull();
    expect(parseIsoDate("not-a-date")).toBeNull();
  });

  it("accepts a leap-day", () => {
    expect(parseIsoDate("2024-02-29")).not.toBeNull();
    expect(parseIsoDate("2025-02-29")).toBeNull();
  });
});

describe("looseParse", () => {
  it("returns empty for empty input", () => {
    expect(looseParse("")).toBe("");
    expect(looseParse("   ")).toBe("");
  });

  it("passes through valid ISO", () => {
    expect(looseParse("2026-04-30")).toBe("2026-04-30");
  });

  it("normalizes US M/D/YYYY", () => {
    expect(looseParse("4/30/2026")).toBe("2026-04-30");
    expect(looseParse("12/5/2026")).toBe("2026-12-05");
  });

  it("normalizes YYYY/MM/DD", () => {
    expect(looseParse("2026/04/30")).toBe("2026-04-30");
  });

  it("returns null for unrecognized input", () => {
    expect(looseParse("blah")).toBeNull();
    expect(looseParse("30 April 2026")).toBeNull();
  });

  it("returns null for overflow", () => {
    expect(looseParse("2026-02-31")).toBeNull();
    expect(looseParse("2/31/2026")).toBeNull();
  });
});

describe("DateField", () => {
  it("renders with the given ISO value formatted for the default (US) display", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect((input as HTMLInputElement).value).toBe("04/30/2026");
  });

  it("renders with ISO display when displayFormat='iso'", () => {
    render(
      <DateField
        value="2026-04-30"
        onChange={() => {}}
        displayFormat="iso"
      />,
    );
    const input = screen.getByRole("textbox");
    expect((input as HTMLInputElement).value).toBe("2026-04-30");
  });

  it("placeholder defaults to MM/DD/YYYY for US format", () => {
    render(<DateField value="" onChange={() => {}} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toBe("MM/DD/YYYY");
  });

  it("placeholder defaults to YYYY-MM-DD for ISO format", () => {
    render(<DateField value="" onChange={() => {}} displayFormat="iso" />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toBe("YYYY-MM-DD");
  });

  it("commits a valid ISO on blur", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2026-01-15" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-01-15");
  });

  it("commits a US-format date by normalizing to ISO", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1/15/2026" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-01-15");
  });

  it("reverts to last committed value on invalid input", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-01-15" onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "garbage" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    // Default display is US-formatted.
    expect(input.value).toBe("01/15/2026");
  });

  it("clears via empty input", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-01-15" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("rejects non-numeric typing while in progress", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.value).toBe("");
  });

  it("opens the calendar popover when the calendar button is clicked", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    const button = screen.getByRole("button", { name: "Open calendar" });
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeTruthy();
    expect(screen.getByText("April 2026")).toBeTruthy();
  });

  it("selects a day from the calendar", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-04-30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = screen.getByRole("dialog", { name: "Calendar" });
    // Apr 15 is reliably in-month
    const day = within(dialog).getByRole("button", { name: "2026-04-15" });
    fireEvent.click(day);
    expect(onChange).toHaveBeenCalledWith("2026-04-15");
  });

  it("navigates to the previous month (per-button context name)", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    // Per-button names include the target month so each press re-announces.
    fireEvent.click(
      screen.getByRole("button", { name: "Previous month, March 2026" }),
    );
    expect(screen.getByText("March 2026")).toBeTruthy();
  });

  it("renders presets and selects when clicked", () => {
    const onChange = vi.fn();
    render(
      <DateField
        value=""
        onChange={onChange}
        presets={[{ label: "Today preset", value: "2026-04-30" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    fireEvent.click(screen.getByText("Today preset"));
    expect(onChange).toHaveBeenCalledWith("2026-04-30");
  });

  it("rejects a day below the min", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-04-15" onChange={onChange} min="2026-04-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = screen.getByRole("dialog", { name: "Calendar" });
    // Apr 5 is in-month and below the min — disabled.
    const day = within(dialog).getByRole("button", { name: "2026-04-05" });
    expect((day as HTMLButtonElement).disabled).toBe(true);
  });

  it("Clear button wipes the value", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-04-30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
