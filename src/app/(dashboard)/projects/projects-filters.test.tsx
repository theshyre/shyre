import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import { renderWithIntl } from "@/test/intl";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/projects",
  useSearchParams: () => mockSearchParams,
}));

import {
  StatusFilter,
  CustomerFilter,
  ProjectSearchInput,
  ProjectFiltersClearHint,
} from "./projects-filters";

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe("StatusFilter", () => {
  it("exposes '{dimension}: {value}' as the trigger's accessible name", () => {
    renderWithIntl(<StatusFilter selected="active" />);
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("lists every status with the selected one checked", () => {
    renderWithIntl(<StatusFilter selected="paused" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Paused" }));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All statuses",
      "Active",
      "Paused",
      "Completed",
      "Archived",
    ]);
    const selected = screen.getByRole("option", { name: "Paused" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected.querySelector("svg.lucide-circle-check-big")).not.toBeNull();
  });

  it("pushes ?status= for a named status and returns focus to the trigger", () => {
    renderWithIntl(<StatusFilter selected="active" />);
    const trigger = screen.getByRole("button", { name: "Status: Active" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Completed" }));
    expect(mockPush).toHaveBeenCalledWith("/projects?status=completed");
    expect(document.activeElement).toBe(trigger);
  });

  it("strips ?status= when picking the default (active)", () => {
    mockSearchParams = new URLSearchParams("status=archived&q=x");
    renderWithIntl(<StatusFilter selected="archived" />);
    fireEvent.click(screen.getByRole("button", { name: "Status: Archived" }));
    fireEvent.click(screen.getByRole("option", { name: "Active" }));
    expect(mockPush).toHaveBeenCalledWith("/projects?q=x");
  });
});

describe("CustomerFilter", () => {
  const customers = [
    { id: "c-1", name: "Acme Corp" },
    { id: "c-2", name: "Globex" },
  ];

  it("renders nothing when there are no customers", () => {
    const { container } = renderWithIntl(
      <CustomerFilter selection={{ kind: "all" }} customers={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the selected customer's name on the trigger", () => {
    renderWithIntl(
      <CustomerFilter
        selection={{ kind: "id", id: "c-2" }}
        customers={customers}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Customer: Globex" }),
    ).toBeInTheDocument();
  });

  it("falls back to the unknown label for a stale customer id", () => {
    renderWithIntl(
      <CustomerFilter
        selection={{ kind: "id", id: "gone" }}
        customers={customers}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Customer: Unknown customer" }),
    ).toBeInTheDocument();
  });

  it("pushes ?customer=<id> when a customer is picked", () => {
    renderWithIntl(
      <CustomerFilter selection={{ kind: "all" }} customers={customers} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Customer: All customers" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Acme Corp" }));
    expect(mockPush).toHaveBeenCalledWith("/projects?customer=c-1");
  });

  it("pushes ?customer=internal for the internal bucket and strips it for All", () => {
    mockSearchParams = new URLSearchParams("customer=c-1");
    renderWithIntl(
      <CustomerFilter
        selection={{ kind: "id", id: "c-1" }}
        customers={customers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Customer: Acme Corp" }));
    fireEvent.click(screen.getByRole("option", { name: "Internal projects" }));
    expect(mockPush).toHaveBeenCalledWith("/projects?customer=internal");

    mockPush.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Customer: Acme Corp" }));
    fireEvent.click(screen.getByRole("option", { name: "All customers" }));
    expect(mockPush).toHaveBeenCalledWith("/projects?");
  });
});

describe("ProjectSearchInput", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounce-commits ?q= after 300ms of idle", () => {
    vi.useFakeTimers();
    renderWithIntl(<ProjectSearchInput initialQuery="" />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search projects by name" }),
      { target: { value: "atlas" } },
    );
    expect(mockPush).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockPush).toHaveBeenCalledWith("/projects?q=atlas");
  });

  it("clears ?q= when the query is emptied", () => {
    mockSearchParams = new URLSearchParams("q=atlas");
    renderWithIntl(<ProjectSearchInput initialQuery="atlas" />);
    const input = screen.getByRole("searchbox", {
      name: "Search projects by name",
    });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(mockPush).toHaveBeenCalledWith("/projects?");
  });
});

describe("ProjectFiltersClearHint", () => {
  it("renders nothing when inactive", () => {
    const { container } = renderWithIntl(<ProjectFiltersClearHint active={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("clears status, customer, and q in one push", () => {
    mockSearchParams = new URLSearchParams(
      "status=archived&customer=c-1&q=x&org=t-1",
    );
    renderWithIntl(<ProjectFiltersClearHint active />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(mockPush).toHaveBeenCalledWith("/projects?org=t-1");
  });
});
