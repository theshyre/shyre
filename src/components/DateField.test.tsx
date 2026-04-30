import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  DateField,
  parseIsoDate,
  looseParse,
  formatForDisplay,
  localeToFormat,
} from "./DateField";

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
    const input = screen.getByRole("combobox");
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
    const input = screen.getByRole("combobox");
    expect((input as HTMLInputElement).value).toBe("2026-04-30");
  });

  it("placeholder defaults to MM/DD/YYYY for US format", () => {
    render(<DateField value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.placeholder).toBe("MM/DD/YYYY");
  });

  it("placeholder defaults to YYYY-MM-DD for ISO format", () => {
    render(<DateField value="" onChange={() => {}} displayFormat="iso" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.placeholder).toBe("YYYY-MM-DD");
  });

  it("commits a valid ISO on blur", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2026-01-15" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-01-15");
  });

  it("commits a US-format date by normalizing to ISO", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1/15/2026" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-01-15");
  });

  it("reverts to last committed value on invalid input", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-01-15" onChange={onChange} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
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
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("rejects non-numeric typing while in progress", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
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
    // Apr 15 is reliably in-month — cells are role="gridcell" per the
    // APG date picker dialog pattern.
    const day = within(dialog).getByRole("gridcell", { name: "2026-04-15" });
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
    const day = within(dialog).getByRole("gridcell", { name: "2026-04-05" });
    expect((day as HTMLButtonElement).disabled).toBe(true);
  });

  it("Clear button wipes the value", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-04-30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  // --------------------------------------------------------------
  // Faster popover access (per ux-designer review)
  // --------------------------------------------------------------

  it("Alt+ArrowDown on the input opens the popover", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeTruthy();
  });

  it("bare ArrowDown opens the popover only when the input is empty", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateField value="" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    // Empty → bare ArrowDown opens
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByRole("dialog", { name: "Calendar" })).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    // Non-empty → bare ArrowDown does NOT open (caret moves instead)
    rerender(<DateField value="2026-04-30" onChange={onChange} />);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // The popover should be closed; query returns null
    expect(screen.queryByRole("dialog", { name: "Calendar" })).toBeNull();
  });

  it("double-click on the input opens the popover", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.doubleClick(input);
    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeTruthy();
  });

  // --------------------------------------------------------------
  // APG roving tabindex + arrow-key navigation in the day grid
  // --------------------------------------------------------------

  it("only the focused cell has tabIndex=0 (roving tabindex)", () => {
    render(<DateField value="2026-04-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = screen.getByRole("dialog", { name: "Calendar" });
    const focused = within(dialog).getByRole("gridcell", { name: "2026-04-15" });
    expect(focused.getAttribute("tabindex")).toBe("0");
    // A different cell should be tabIndex=-1
    const other = within(dialog).getByRole("gridcell", { name: "2026-04-10" });
    expect(other.getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowRight / ArrowLeft move the focused cell by one day", () => {
    render(<DateField value="2026-04-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = screen.getByRole("dialog", { name: "Calendar" });
    const grid = within(dialog).getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    // 2026-04-16 is now the focus target
    expect(
      within(dialog).getByRole("gridcell", { name: "2026-04-16" })
        .getAttribute("tabindex"),
    ).toBe("0");
  });

  it("ArrowDown moves the focused cell by one week", () => {
    render(<DateField value="2026-04-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const dialog = screen.getByRole("dialog", { name: "Calendar" });
    const grid = within(dialog).getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(
      within(dialog).getByRole("gridcell", { name: "2026-04-22" })
        .getAttribute("tabindex"),
    ).toBe("0");
  });

  it("Enter on a focused cell selects it", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-04-15" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2026-04-16");
  });

  it("ArrowRight on the last day of the month crosses into the next month", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    // View should now show May 2026
    expect(screen.getByText("May 2026")).toBeTruthy();
  });

  // --------------------------------------------------------------
  // Regression: prev/next month must NOT close the popover
  // --------------------------------------------------------------

  it("clicking the Previous month arrow keeps the popover open and shifts the view", () => {
    // Earlier bug: clicking < (prev month) would unmount the focused
    // day cell because focusedIso belonged to the OLD view; focus
    // fell to body; the focusin handler interpreted body as "user
    // tabbed out" and closed the popover mid-click. Both fixes —
    // filtering body in the focusin handler AND shifting focusedIso
    // along with the view — together must keep the popover open.
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(
      screen.getByRole("dialog", { name: "Calendar" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Previous month, March 2026" }),
    );
    // Popover still open with the new month visible
    expect(
      screen.queryByRole("dialog", { name: "Calendar" }),
    ).not.toBeNull();
    expect(screen.getByText("March 2026")).toBeTruthy();
  });

  it("focusin on document.body does NOT close the popover (DOM-removal noise)", () => {
    render(<DateField value="2026-04-30" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(
      screen.getByRole("dialog", { name: "Calendar" }),
    ).toBeTruthy();
    // Simulate the browser parking focus on body after a cell unmount.
    const evt = new FocusEvent("focusin", { bubbles: true });
    Object.defineProperty(evt, "target", { value: document.body });
    document.dispatchEvent(evt);
    // Popover stays open — body-target focusin is filtered out.
    expect(
      screen.queryByRole("dialog", { name: "Calendar" }),
    ).not.toBeNull();
  });

  // --------------------------------------------------------------
  // dmy display format
  // --------------------------------------------------------------

  it("renders DD/MM/YYYY when displayFormat='dmy'", () => {
    render(
      <DateField value="2026-04-30" onChange={() => {}} displayFormat="dmy" />,
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("30/04/2026");
    expect(input.placeholder).toBe("DD/MM/YYYY");
  });

  it("dmy format parses slashed input as DD/MM/YYYY", () => {
    const onChange = vi.fn();
    render(
      <DateField value="" onChange={onChange} displayFormat="dmy" />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "30/04/2026" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-04-30");
  });

  it("us format parses the same slashed input as MM/DD/YYYY", () => {
    const onChange = vi.fn();
    // 04/05/2026 → us reads as April 5; dmy reads as May 4. Disambiguation
    // is the whole point of the format hint.
    render(<DateField value="" onChange={onChange} displayFormat="us" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "04/05/2026" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-04-05");
  });
});

// --------------------------------------------------------------
// Pure helpers
// --------------------------------------------------------------

describe("formatForDisplay", () => {
  it("formats us as MM/DD/YYYY", () => {
    expect(formatForDisplay("2026-04-30", "us")).toBe("04/30/2026");
  });
  it("formats dmy as DD/MM/YYYY", () => {
    expect(formatForDisplay("2026-04-30", "dmy")).toBe("30/04/2026");
  });
  it("passes ISO through unchanged", () => {
    expect(formatForDisplay("2026-04-30", "iso")).toBe("2026-04-30");
  });
  it("returns empty for empty", () => {
    expect(formatForDisplay("", "us")).toBe("");
    expect(formatForDisplay("", "dmy")).toBe("");
    expect(formatForDisplay("", "iso")).toBe("");
  });
});

describe("localeToFormat", () => {
  it("en-US → us", () => {
    expect(localeToFormat("en-US")).toBe("us");
  });
  it("en (no region) → us (sensible default)", () => {
    expect(localeToFormat("en")).toBe("us");
  });
  it("en-GB → dmy", () => {
    expect(localeToFormat("en-GB")).toBe("dmy");
  });
  it("es / fr / de → dmy", () => {
    expect(localeToFormat("es")).toBe("dmy");
    expect(localeToFormat("fr-FR")).toBe("dmy");
    expect(localeToFormat("de-DE")).toBe("dmy");
  });
  it("unknown / null → us (safest sortable default for ambiguous)", () => {
    expect(localeToFormat(null)).toBe("us");
    expect(localeToFormat("")).toBe("us");
    expect(localeToFormat("ja-JP")).toBe("iso");
  });
});
