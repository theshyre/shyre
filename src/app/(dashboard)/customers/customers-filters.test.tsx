import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/customers",
  useSearchParams: () => mockSearchParams,
}));

import { CustomerStatusFilter } from "./customers-filters";

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe("CustomerStatusFilter", () => {
  it("exposes '{dimension}: {value}' as the trigger's accessible name", () => {
    renderWithIntl(<CustomerStatusFilter selected="all" />);
    const trigger = screen.getByRole("button", { name: "Status: All" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lists all four lifecycle options with the selected one checked", () => {
    renderWithIntl(<CustomerStatusFilter selected="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Inactive" }));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All",
      "Active",
      "Inactive",
      "Archived",
    ]);
    const selected = screen.getByRole("option", { name: "Inactive" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(
      selected.querySelector("svg.lucide-circle-check-big"),
    ).not.toBeNull();
  });

  it("pushes ?status= for a named status and returns focus to the trigger", () => {
    renderWithIntl(<CustomerStatusFilter selected="all" />);
    const trigger = screen.getByRole("button", { name: "Status: All" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Archived" }));
    expect(mockPush).toHaveBeenCalledWith("/customers?status=archived");
    expect(document.activeElement).toBe(trigger);
  });

  it("strips ?status= when picking the default (all)", () => {
    mockSearchParams = new URLSearchParams("status=archived");
    renderWithIntl(<CustomerStatusFilter selected="archived" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Archived" }));
    fireEvent.click(screen.getByRole("option", { name: "All" }));
    expect(mockPush).toHaveBeenCalledWith("/customers?");
  });

  it("preserves unrelated params (org, bounced) across a pick", () => {
    mockSearchParams = new URLSearchParams("org=t-1&bounced=1");
    renderWithIntl(<CustomerStatusFilter selected="all" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("option", { name: "Inactive" }));
    expect(mockPush).toHaveBeenCalledWith(
      "/customers?org=t-1&bounced=1&status=inactive",
    );
  });

  it("resets the load-more limit when the filter changes", () => {
    mockSearchParams = new URLSearchParams("limit=100");
    renderWithIntl(<CustomerStatusFilter selected="all" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("option", { name: "Active" }));
    expect(mockPush).toHaveBeenCalledWith("/customers?status=active");
  });

  it("closes on Escape and returns focus to the trigger without a push", () => {
    renderWithIntl(<CustomerStatusFilter selected="all" />);
    const trigger = screen.getByRole("button", { name: "Status: All" });
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(4);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("option")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
