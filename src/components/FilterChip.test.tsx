import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChip, type FilterChipOption } from "./FilterChip";

function makeOptions(selected: string): FilterChipOption[] {
  return [
    { key: "all", label: "All statuses", selected: selected === "all" },
    { key: "active", label: "Active", selected: selected === "active" },
    {
      key: "paused",
      label: "Paused",
      selected: selected === "paused",
      separatorAfter: true,
    },
    { key: "archived", label: "Archived", selected: selected === "archived" },
  ];
}

function renderChip(
  overrides: Partial<{
    listboxLabel: string;
    customized: boolean;
    valueLabel: string;
  }> = {},
): { onPick: ReturnType<typeof vi.fn> } {
  const onPick = vi.fn();
  render(
    <FilterChip
      icon={<svg data-testid="trigger-icon" />}
      dimensionLabel="Status"
      valueLabel="Active"
      customized={false}
      options={makeOptions("active")}
      onPick={onPick}
      {...overrides}
    />,
  );
  return { onPick };
}

describe("FilterChip", () => {
  it("names the trigger '{dimension}: {current value}' with haspopup/expanded semantics", () => {
    renderChip();
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("labels the listbox with listboxLabel, falling back to the dimension", () => {
    renderChip({ listboxLabel: "Filter by status" });
    fireEvent.click(screen.getByRole("button", { name: "Status: Active" }));
    expect(
      screen.getByRole("listbox", { name: "Filter by status" }),
    ).toBeInTheDocument();
  });

  it("marks the selected option with aria-selected AND a check icon (never fill alone)", () => {
    renderChip();
    fireEvent.click(screen.getByRole("button", { name: "Status: Active" }));
    const selectedOpt = screen.getByRole("option", { name: "Active" });
    expect(selectedOpt).toHaveAttribute("aria-selected", "true");
    expect(selectedOpt.querySelector("svg.lucide-circle-check-big")).not.toBeNull();
    const otherOpt = screen.getByRole("option", { name: "Paused" });
    expect(otherOpt).toHaveAttribute("aria-selected", "false");
    expect(otherOpt.querySelector("svg.lucide-circle-check-big")).toBeNull();
  });

  it("picking an option calls onPick, closes the panel, and returns focus to the trigger", () => {
    const { onPick } = renderChip();
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Paused" }));
    expect(onPick).toHaveBeenCalledWith("paused");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes the panel and returns focus to the trigger", () => {
    renderChip();
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    fireEvent.click(trigger);
    // Focus can be anywhere inside the panel when Escape lands.
    screen.getByRole("option", { name: "Archived" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("a consumed Escape never reaches page-level keydown listeners (rule-5 overlay guard)", () => {
    renderChip();
    fireEvent.click(screen.getByRole("button", { name: "Status: Active" }));
    const pageHandler = vi.fn();
    document.addEventListener("keydown", pageHandler);
    const option = screen.getByRole("option", { name: "Active" });
    option.focus();
    fireEvent.keyDown(option, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // A page-level "clear selection on Escape" handler must NOT fire.
    expect(pageHandler).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pageHandler);
  });

  it("links the trigger to the open panel via aria-controls", () => {
    renderChip();
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    expect(trigger).not.toHaveAttribute("aria-controls");
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox");
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
  });

  it("outside click closes the panel without yanking focus to the trigger", () => {
    renderChip();
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("renders per-option icons, the separator divider, and the footer slot", () => {
    const { container } = render(
      <FilterChip
        icon={<svg data-testid="trigger-icon" />}
        dimensionLabel="Customer"
        valueLabel="All customers"
        customized={false}
        options={[
          {
            key: "all",
            label: "All customers",
            selected: true,
            icon: <svg data-testid="opt-icon" />,
            separatorAfter: true,
          },
          { key: "c1", label: "Acme", selected: false },
        ]}
        onPick={vi.fn()}
        footer={<div data-testid="chip-footer">footer</div>}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Customer: All customers" }),
    );
    expect(screen.getByTestId("opt-icon")).toBeInTheDocument();
    expect(screen.getByTestId("chip-footer")).toBeInTheDocument();
    expect(container.querySelector(".border-edge-muted")).not.toBeNull();
    // The footer and separators must not pollute the listbox's option
    // list: footer sits OUTSIDE the role=listbox element, separators
    // are aria-hidden.
    const listbox = screen.getByRole("listbox");
    expect(listbox.contains(screen.getByTestId("chip-footer"))).toBe(false);
    expect(
      listbox.querySelector(".border-edge-muted"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("uses accent-soft chrome only when customized (with the border cue, not fill alone)", () => {
    renderChip({ customized: true, valueLabel: "Paused" });
    const trigger = screen.getByRole("button", { name: "Status: Paused" });
    expect(trigger.className).toContain("bg-accent-soft");
    expect(trigger.className).toContain("border-accent/30");
  });
});
